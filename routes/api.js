const fs = require("fs");
const path = require("path");
const { exec, execSync } = require("child_process");
const ncp = require("ncp").ncp;
var express = require("express");
var router = express.Router();
const yaml = require("js-yaml");
const { v4: uuidv4 } = require("uuid");
const { readDatabase, writeDatabase } = require("../utils/helpers");
const { launchPadLogger } = require("../utils/launchPadLogger");


// DB File location
const DB_FILE = path.join(__dirname, "../database/database.json");

// Function to get the next available network instance index
function getNextInstanceIndex(callback) {
  exec('docker network ls --format "{{.Name}}"', (err, stdout) => {
    if (err) {
      launchPadLogger.error("Error fetching Docker networks:", err.message);
      return callback(err, null);
    }
    // Split output into individual network names
    const allNetworks = stdout.split("\n").filter(Boolean);
    launchPadLogger.debug(allNetworks);

    // Find networks matching the format: _network
    const instanceNetworks = allNetworks.filter((name) =>
      /_network$/.test(name)
    );
    launchPadLogger.debug(instanceNetworks);

    callback(null, instanceNetworks.length);
  });
}

// Function to generate a dynamic subnet based on instance number
function getDynamicSubnet(instanceIndex) {
  const baseSubnet = "10.5";

  // Make thirdOctet align properly: starting from 1 when instanceIndex = 0
  const thirdOctet = instanceIndex + 1;

  launchPadLogger.log("new instance index");
  launchPadLogger.log(thirdOctet);

  return {
    subnet: `${baseSubnet}.${thirdOctet}.0/24`,
    gateway: `${baseSubnet}.${thirdOctet}.1`,
    tigerbeetleIp: `${baseSubnet}.${thirdOctet}.50`,
  };
}

// Modify Docker Compose File
function modifyDockerCompose(filePath, instanceName, instanceIndex,instanceWebhookURL,instanceExchangeRateURL) {
  const { subnet, gateway, tigerbeetleIp } = getDynamicSubnet(instanceIndex);
  launchPadLogger.debug(tigerbeetleIp);

  const yamlContent = yaml.load(fs.readFileSync(filePath, "utf8"));

  for (const [serviceName, service] of Object.entries(yamlContent.services)) {
    if (serviceName === "tigerbeetle") {
      // Special case for tigerbeetle with ipv4_address
      service.networks = {
        [`${instanceName}_network`]: {
          ipv4_address: tigerbeetleIp,
        },
      };
      service.volumes = [`${instanceName}_tigerbeetle-data:/var/lib/tigerbeetle`];
  
    } else {
      // For all other services, networks is an array
      service.networks = [`${instanceName}_network`];
    }

    if (serviceName === "rafiki-backend") {
      // modify the rafiki backend based on user input options
      service.environment.WEBHOOK_URL = instanceWebhookURL,
      service.environment.EXCHANGE_RATES_URL = instanceExchangeRateURL
    }
  }

  // Modify `networks` section
  yamlContent.networks = yamlContent.networks || {};
  if (!yamlContent.networks[`${instanceName}_network`]) {
    yamlContent.networks[`${instanceName}_network`] = {
      name: `${instanceName}_network`,
      driver: "bridge",
      ipam: {
        config: [
          {
            subnet: subnet,
            gateway: gateway,
          },
        ],
      },
    };
  }

  yamlContent.volumes = {
    ...(yamlContent.volumes || {}),
    [`${instanceName}_tigerbeetle-data`]: {} // Declare named volume
  };

  // Write the updated YAML back
  fs.writeFileSync(filePath, yaml.dump(yamlContent, { indent: 2 }), "utf8");

  launchPadLogger.log(`Updated Docker Compose file for ${instanceName}`);
}
function modifyNginxDockerCompose(filePath, instanceName) {
  const yamlContent = yaml.load(fs.readFileSync(filePath, "utf8"));

  // Modify the networks section for all services
  for (const service of Object.values(yamlContent.services)) {
    // Assign the instance's network dynamically to each service
    service.networks = service.networks || [];
    if (!service.networks.includes(`${instanceName}_network`)) {
      service.networks.push(`${instanceName}_network`);
    }
  }

  // Modify `networks` section
  yamlContent.networks = yamlContent.networks || {};
  if (!yamlContent.networks[`${instanceName}_network`]) {
    yamlContent.networks[`${instanceName}_network`] = { external: true };
  }

  // Write the updated YAML back
  fs.writeFileSync(filePath, yaml.dump(yamlContent, { indent: 2 }), "utf8");

  launchPadLogger.log(`Updated nginx Docker Compose file for ${instanceName}`);
}

// Create anonymous user token
router.post("/get-new-token", (req, res) => {
  const token = uuidv4(); // Generate a unique token

  const database = readDatabase(DB_FILE);
  if (!database[token]) {
    database[token] = { instances: [] }; // Initialize with an empty list
  }

  writeDatabase(DB_FILE, database);
  res.json({ token });
});

// get user instances
router.get("/get-instances", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  const database = readDatabase(DB_FILE);

  if (!database[token]) {
    return res.status(404).json({ error: "Invalid token" });
  }

  res.json({ instances: database[token].instances });
});


// POST endpoint to handle instance creation for a user
router.post("/create-instance", async (req, res) => {
  // Handle check user token
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ status: 401, message: "No token provided" });
  }

  const database = readDatabase(DB_FILE);
  if (!database[token]) {
    return res.status(404).json({ status: 404, message: 'Token does not exist in database' });
  }

  const instanceName = req.body.instanceName;
  const instanceExchangeRateURL = req.body.instanceExchangeRateURL || "";
  const instanceWebhookURL = req.body.instanceWebhookURL || "";
  
  if (!instanceName) {
    return res.status(400).json({ status: 400, message: "Instance name is required." });
  }

  const instanceDir = path.join(__dirname, "../rafiki_instances", instanceName);

  if (fs.existsSync(instanceDir)) {
    return res.status(400).json({ status: 400, message: "Instance already exists. Kindly use another name" });
  }

  const nginxTemplate = `
   server {
       listen 80;
       server_name ${instanceName}.rafiki-launchpad.devligence.com;

       location / {
           resolver 127.0.0.11 valid=30s;
           set $backend "${instanceName}_rafiki-backend:3001";
           proxy_pass http://$backend;

           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;

           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";

           proxy_connect_timeout 60s;
           proxy_send_timeout 60s;
           proxy_read_timeout 60s;
       }
   }`;

  const nginxConfigPath = path.join(__dirname, "../nginx/default.conf");

  const originalNginxContainerComposeContent = fs.readFileSync(nginxConfigPath, "utf8");


  const operations = []; // Keep track of successful operations for rollback

  // save previous compose incase of a revert
  const originalNginxComposeContent = fs.readFileSync('./docker-compose.yaml', "utf8");

  try {
    // Append Nginx config if not already present
    const nginxConfig = fs.readFileSync(nginxConfigPath, "utf8");
    if (!nginxConfig.includes(`${instanceName}.local`)) {
      fs.appendFileSync(nginxConfigPath, nginxTemplate);
      operations.push(() => {
        fs.writeFileSync(nginxConfigPath, originalNginxContainerComposeContent, "utf8");
        // Rollback nginx config by removing appended template
        // const updatedConfig = fs.readFileSync(nginxConfigPath, "utf8")
        //   .replace(nginxTemplate, "");
        // fs.writeFileSync(nginxConfigPath, updatedConfig);
      });
    }

    // Create instance directory
    fs.mkdirSync(instanceDir, { recursive: true });
    operations.push(() => fs.rmdirSync(instanceDir, { recursive: true }));

    // Copy template files
    await new Promise((resolve, reject) => {
      const templatePath = path.join(__dirname, "../rafiki_template");
      ncp(templatePath, instanceDir, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const composeFile = path.join(instanceDir, "dev/docker-compose.yml");
    const instanceIndex = await new Promise((resolve, reject) => {
      getNextInstanceIndex((err, index) => {
        if (err) reject(err);
        else resolve(index);
      });
    });

    modifyDockerCompose(composeFile, instanceName, instanceIndex, instanceWebhookURL, instanceExchangeRateURL);
    modifyNginxDockerCompose("./docker-compose.yaml", instanceName);

    // Start the instance
    await new Promise((resolve, reject) => {
      exec(`INSTANCE_NAME=${instanceName} docker-compose -f ${composeFile} --project-name ${instanceName} up -d`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    operations.push(() => {
      execSync(`docker ps -q --filter "name=^${instanceName}_" | xargs -r docker rm -f`);
      execSync(`docker ps -aq --filter "name=^${instanceName}_" --filter "status=created" | xargs -r docker rm`);
    });

    // Restart Nginx container
    await new Promise((resolve, reject) => {
      exec(`docker-compose -f ./docker-compose.yaml down --volumes && docker-compose -f ./docker-compose.yaml up --build -d`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    // Add instance to database
    const containerId = execSync(`docker ps -q --filter "name=${instanceName}_rafiki-backend"`).toString().trim();
    const [status, createdAt] = execSync(`docker inspect --format='{{.State.Status}} {{.Created}}' ${containerId}`).toString().split(" ");
    database[token].instances.push({
      id: containerId,
      instance_name: instanceName,
      admin_api: `${instanceName}.rafiki-launchpad.devligence.com`,
      created_at: createdAt,
      status: status || 'Active',
    });
    writeDatabase(DB_FILE, database);

    res.status(200).json({ status: 200, message: `${instanceName} (Rafiki instance) creation success.` });
  } catch (error) {
    launchPadLogger.error(`Error creating instance: ${error.message}`);
    for (const rollback of operations.reverse()) {
      try { rollback(); } catch (e) { launchPadLogger.error(`Rollback failed: ${e.message}`); }
    }
    // Restore the original content of docker-compose.yaml
    fs.writeFileSync("./docker-compose.yaml", originalNginxComposeContent, "utf8");
    execSync(`docker ps -aq -f "status=exited" | xargs -r docker rm`)
    execSync(`docker network rm ${instanceName}_network`)
    res.status(500).json({ status: 500, message: `Error creating instance. Changes reverted. ${error.message}` });
  }
});


router.get("/status/:instanceName", (req, res) => {
  const { instanceName } = req.params;

  // Fetch both the container name and status
  exec(
    `docker ps --filter "name=${instanceName}_" --format "{{.Names}}: {{.Status}}"`,
    (error, stdout) => {
      if (error) {
        launchPadLogger.error(`Error fetching status for ${instanceName}: ${error.message}`);
        return res
          .status(500)
          .json({ status:500,
            message: `Error fetching status for ${instanceName}: ${error.message}`,
          });
      }

      const containerStatuses = stdout
        .split("\n")
        .filter((line) => line !== "");
      if (containerStatuses.length > 0) {
        // Create a JSON response with container statuses
        const statusResponse = containerStatuses.map((line) => {
          const [name, status] = line.split(": ");
          return { container: name, status: status };
        });

        res.status(200).json({ status:200, message: {instanceName:instanceName,statusResponse:statusResponse} });
      } else {
        res
          .status(404)
          .json({ status:400,message: `No containers found for ${instanceName}` });
      }
    }
  );
});

module.exports = router;

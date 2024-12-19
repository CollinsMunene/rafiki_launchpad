const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const ncp = require("ncp").ncp;
var express = require("express");
var router = express.Router();
const yaml = require("js-yaml");
const { v4: uuidv4 } = require("uuid");
const { readDatabase, writeDatabase } = require("../utils/helpers");

// File location
const DB_FILE = path.join(__dirname, "../database/database.json");

// Function to get the next available instance index
function getNextInstanceIndex(callback) {
  console.log("next isntance")
  exec('docker network ls --format "{{.Name}}"', (err, stdout) => {
    if (err) {
      console.error("Error fetching Docker networks:", err.message);
      return callback(err, null);
    }
    // Split output into individual network names
    const allNetworks = stdout.split("\n").filter(Boolean);

    // Find networks matching the format: user-<number>-instance_network
    const instanceNetworks = allNetworks.filter((name) =>
      /_network$/.test(name)
    );
    console.log(instanceNetworks);
    // Extract numeric indices (if available) from filtered network names
    const indices = instanceNetworks.map((name) => {
      const match = name.match(/(\d+)(?=-.*_network$)/);
      return match ? parseInt(match[1], 10) : 0;
    });
    console.log(indices);

    // Determine the next available index
    const nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;
    callback(null, nextIndex);
  });
}

// Function to generate a dynamic subnet based on instance number
function getDynamicSubnet(instanceIndex) {
  const baseSubnet = "10.5";

  console.log("initial index");
  console.log(instanceIndex);

  // Make thirdOctet align properly: starting from 1 when instanceIndex = 0
  const thirdOctet = instanceIndex + 1;

  console.log("instance indec");
  console.log(thirdOctet);

  return {
    subnet: `${baseSubnet}.${thirdOctet}.0/24`,
    gateway: `${baseSubnet}.${thirdOctet}.1`,
    tigerbeetleIp: `${baseSubnet}.${thirdOctet}.50`,
  };
}

// Modify Docker Compose File
function modifyDockerCompose(filePath, instanceName, instanceIndex,instanceWebhookURL,instanceExchangeRateURL) {
  const { subnet, gateway, tigerbeetleIp } = getDynamicSubnet(instanceIndex);
  console.log(tigerbeetleIp);

  const yamlContent = yaml.load(fs.readFileSync(filePath, "utf8"));


  for (const [serviceName, service] of Object.entries(yamlContent.services)) {
    console.log(serviceName);
    if (serviceName === "tigerbeetle") {
      // Special case for tigerbeetle with ipv4_address
      service.networks = {
        [`${instanceName}_network`]: {
          ipv4_address: tigerbeetleIp,
        },
      };
    } else {
      // For all other services, networks is an array
      service.networks = [`${instanceName}_network`];
    }

    if (serviceName === "rafiki-backend") {
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

  // Write the updated YAML back
  fs.writeFileSync(filePath, yaml.dump(yamlContent, { indent: 2 }), "utf8");

  console.log(`Updated Docker Compose file for ${instanceName}`);
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

  console.log(`Updated nginx Docker Compose file for ${instanceName}`);
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

// Delete instances for user
router.post("/delete-instance", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  const { instanceId } = req.body;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  const database = readDatabase(DB_FILE);

  if (!database[token]) {
    return res.status(404).json({ error: "Invalid token" });
  }

  // Remove instance with the given ID
  database[token].instances = database[token].instances.filter(
    (instance) => instance.id !== instanceId
  );

  writeDatabase(DB_FILE, database);
  res.json({ success: true });
});

// POST endpoint to handle instance creation for a user
function createExternalNetwork(instanceName) {
  exec(
    `docker network inspect ${instanceName}_network > /dev/null 2>&1 || docker network create ${instanceName}_network`,
    (error, stdout, stderr) => {
      if (error) {
        console.error(`Error creating network: ${stderr}`);
        return;
      }
      console.log(`Network ${instanceName}_network created or already exists.`);
    }
  );
}

router.post("/create-instance", (req, res) => {
  // Handle check user token
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({status:401, message: "No token provided" });
  }

  const database = readDatabase(DB_FILE);

  if (!database[token]) {
    return res.status(404).json({ status:404, message: 'Token does not exist in database' });
  }


  const instanceName = req.body.instanceName;
  const instanceExchangeRateURL = req.body.instanceExchangeRateURL || "";
  const instanceWebhookURL = req.body.instanceWebhookURL || "";

  if (!instanceName) {
    return res.status(400).json({status:400, message: "Instance name is required." });
  }

  const instanceDir = path.join(__dirname, "../rafiki_instances", instanceName);

  if (fs.existsSync(instanceDir)) {
    return res.status(400).json({ status:400,message: "Instance already exists." });
  }

  // Create the external network for this instance dynamically
  // createExternalNetwork(instanceName);

  // Define Nginx Configuration Template
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

  // Append Nginx Config (avoid duplicates)
  // const hostNginxPath = path.join(__dirname, "../nginx", `default.conf`);
  const nginxConfig = fs.readFileSync(nginxConfigPath, "utf8");
  if (!nginxConfig.includes(`${instanceName}.local`)) {
    fs.appendFileSync(nginxConfigPath, nginxTemplate);
  }

  // Create instance directory
  fs.mkdirSync(instanceDir, { recursive: true });

  // Copy template files
  const templatePath = path.join(__dirname, "../rafiki_template");
  ncp(templatePath, instanceDir, (err) => {
    if (err) {
      console.error(`Error copying template: ${err.message}`);
      return res.status(500).json({ status:500,message: "Error copying template." });
    }

    const composeFile = path.join(instanceDir, "dev/docker-compose.yml");
    getNextInstanceIndex((err, instanceIndex) => {
      if (err) return;

      console.log("Next index");
      console.log(instanceIndex);
      // Modify docker-compose.yml
      modifyDockerCompose(composeFile, instanceName, instanceIndex,instanceWebhookURL,instanceExchangeRateURL);

      // Add network to Nginx docker-compose.yml
      const nginxComposePath = "./docker-compose.yaml";
      modifyNginxDockerCompose(nginxComposePath, instanceName);

      // Start the instance
      console.log(composeFile);

      exec(
        `INSTANCE_NAME=${instanceName} docker-compose -f ${composeFile} --project-name ${instanceName} up -d`,
        (error, stdout, stderr) => {
          console.log(error);
          if (error) {
            console.error(`Error starting instance: ${error.message}`);
            return res
              .status(500)
              .json({ status:500,message: `Error starting instance: ${error.message}` });
          }
          console.log("here");
          console.log(stdout, stderr);
          

          // Create Nginx
          exec(
            `docker-compose -f ${nginxComposePath} down --volumes && docker-compose -f ${nginxComposePath} up --build -d`,
            (composeRestartError) => {
              if (composeRestartError) {
                console.error(
                  `Failed to restart container with new networks: ${composeRestartError.message}`
                );
                return;
              }
              console.log(
                `Nginx container restarted with new network for ${instanceName}`
              );

    
               // If docker-compose up succeeds, fetch container details
              console.log(`Container started for instance: ${instanceName}`);

              // Get the container ID or name associated with this instance
              exec(
                `docker ps -q --filter "name=${instanceName}_rafiki-backend"`, 
                (error, stdout, stderr) => {
                  if (error) {
                    console.error(`docker ps error: ${error}`);
                    return;
                  }

                  console.log("docker ps for instance")
                  console.log(stdout)
                  const containerId = stdout.trim();  // Container ID associated with the instance
                  console.log(containerId)
                  if (containerId) {
                    // Use docker inspect to get details about the container, such as its creation time and status
                    exec(
                      `docker inspect --format='{{.State.Status}} {{.Created}}' ${containerId}`,
                      (error, stdout, stderr) => {
                        console.log(stdout)
                        if (error) {
                          console.error(`docker inspect error: ${error}`);
                          return;
                        }

                        // Process the result to display the container status and creation time
                        const [status, createdAt] = stdout.split(' ');  // Separate the status and creation time

                        // Prepare the data to be added to the database
                        const newInstance = {
                          id: containerId, // Use the container ID as the unique instance ID
                          instance_name: instanceName,
                          admin_api: `${instanceName}.rafiki-launchpad.devligence.com`,
                          created_at: createdAt,
                          status: status || 'Active', // Default to 'Active' if status is undefined
                        };

                        // Push the new instance into the database
                        database[token].instances.push(newInstance);

                        // Write the updated database back to the file
                        writeDatabase(DB_FILE, database);

                        console.log(`New instance added to database: ${instanceName}`);


                        res
                        .status(200)
                        .json({status:200,
                          message: `${instanceName} (Rafiki instance) creation Success.`,
                        });
                      }
                    );
                  } else {
                    console.log('No container found with this name.');
                  }
                }
              );
            }
          );
        }
      );
    });
  });
});

router.get("/status/:instanceName", (req, res) => {
  const { instanceName } = req.params;
  console.log(instanceName);
  console.log(
    `docker ps --filter "name=${instanceName}" --format "{{.Status}}"`
  );

  // Fetch both the container name and status
  exec(
    `docker ps --filter "name=${instanceName}_" --format "{{.Names}}: {{.Status}}"`,
    (error, stdout) => {
      if (error) {
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

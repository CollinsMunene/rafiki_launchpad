const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const ncp = require("ncp").ncp;
var express = require("express");
var router = express.Router();
const yaml = require("js-yaml");

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("index", { title: "Express" });
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
  const instanceName = req.body.instanceName;

  if (!instanceName) {
    return res.status(400).send("Instance name is required.");
  }

  const instanceDir = path.join(
    __dirname,
    "../rafiki_instances",
    instanceName
  );

  if (fs.existsSync(instanceDir)) {
    return res.status(400).send("Instance already exists.");
  }

  // Create the external network for this instance dynamically
  // createExternalNetwork(instanceName);


  // Define Nginx Configuration Template
  const nginxTemplate = `
   server {
       listen 80;
       server_name ${instanceName}.local;

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
  const hostNginxPath = path.join(__dirname, "../nginx", `default.conf`);
  const nginxConfig = fs.readFileSync(nginxConfigPath, "utf8");
  if (!nginxConfig.includes(`${instanceName}.local`)) {
    fs.appendFileSync(nginxConfigPath, nginxTemplate);
  }

  // Function to get the next available instance index
function getNextInstanceIndex(callback) {
  exec('docker network ls --format "{{.Name}}"', (err, stdout) => {
    if (err) {
      console.error("Error fetching Docker networks:", err.message);
      return callback(err, null);
    }
    // Split output into individual network names
    const allNetworks = stdout.split('\n').filter(Boolean);

    // Find networks matching the format: user-<number>-instance_network
    const instanceNetworks = allNetworks.filter((name) => /_network$/.test(name));
    console.log(instanceNetworks)
    // Extract numeric indices (if available) from filtered network names
    const indices = instanceNetworks.map((name) => {
      const match = name.match(/(\d+)(?=-.*_network$)/);
      return match ? parseInt(match[1], 10) : 0;
    });
    console.log(indices)
    

    // Determine the next available index
    const nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;
    callback(null, nextIndex);
  });
}

  // Function to generate a dynamic subnet based on instance number
  function getDynamicSubnet(instanceIndex) {
    const baseSubnet = '10.5';
  
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
  function modifyDockerCompose(filePath, instanceName,instanceIndex) {
    const { subnet, gateway, tigerbeetleIp } = getDynamicSubnet(instanceIndex);
    console.log(tigerbeetleIp)

    const yamlContent = yaml.load(fs.readFileSync(filePath, "utf8"));

    // Modify `services` section networks
    // for (const service of Object.values(yamlContent.services)) {
    //   service.networks = [`${instanceName}_network`];
    //   console.log(service.name)
    //   if (service.name === 'tigerbeetle') {
    //     service.networks[`${instanceName}_network`] = {
    //       "ipv4_address": tigerbeetleIp
    //     };
    //   }
    // }

    for (const [serviceName, service] of Object.entries(yamlContent.services)) {
      console.log(serviceName)
      if (serviceName === 'tigerbeetle') {
        // Special case for tigerbeetle with ipv4_address
        service.networks = {
          [`${instanceName}_network`]: {
            ipv4_address: tigerbeetleIp
          }
        };
      } else {
        // For all other services, networks is an array
        service.networks = [`${instanceName}_network`];
      }
    }

    // Modify `networks` section
    yamlContent.networks = yamlContent.networks || {};
    if (!yamlContent.networks[`${instanceName}_network`]) {
      yamlContent.networks[`${instanceName}_network`] = {
        "name": `${instanceName}_network`,
        "driver": "bridge",
        "ipam": {
          "config": [
            {
              "subnet": subnet,
              "gateway": gateway,
            }
          ]
        }
      };
    }

    // Write the updated YAML back
    fs.writeFileSync(filePath, yaml.dump(yamlContent), "utf8");
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
    fs.writeFileSync(filePath, yaml.dump(yamlContent), "utf8");
    console.log(`Updated nginx Docker Compose file for ${instanceName}`);
  }

  // Create instance directory
  fs.mkdirSync(instanceDir, { recursive: true });


  // Copy template files
  const templatePath = path.join(__dirname, "../rafiki_template");
  ncp(templatePath, instanceDir, (err) => {
    if (err) {
      console.error(`Error copying template: ${err.message}`);
      return res.status(500).send("Error copying template.");
    }

    const composeFile = path.join(instanceDir, "dev/docker-compose.yml");
    getNextInstanceIndex((err, instanceIndex) => {
      if (err) return;

      console.log("Next index");
      console.log(instanceIndex)
          // Modify docker-compose.yml
    modifyDockerCompose(composeFile, instanceName,instanceIndex);

    // Add network to Nginx docker-compose.yml
    const nginxComposePath = "./docker-compose.yaml";
    modifyNginxDockerCompose(nginxComposePath, instanceName);

    // Start the instance
    console.log(composeFile)
    
    exec(
      `INSTANCE_NAME=${instanceName} docker-compose -f ${composeFile} --project-name ${instanceName} up -d`,
      (error, stdout, stderr) => {
        console.log(error)
        if (error) {
          console.error(`Error starting instance: ${error.message}`);
          return res
            .status(500)
            .send(`Error starting instance: ${error.message}`);
        }
        console.log("here")
        console.log(stdout, stderr);

        // Reload Nginx
        console.log(hostNginxPath)
        // exec(`docker stop nginx`, (stopError) => {
        //   if (stopError) {
        //     console.error(`Failed to stop Nginx container: ${stopError.message}`);
        //     return;
        //   }
        
        //   exec(`docker cp ${hostNginxPath} nginx:/etc/nginx/conf.d/default.conf`, (copyError) => {
        //     if (copyError) {
        //       console.error(`Failed to copy Nginx config: ${copyError.message}`);
        //       return;
        //     }
        
        //     console.log("Config file copied successfully!");
        
            // exec(`docker start nginx`, (startError) => {
            //   if (startError) {
            //     console.error(`Failed to start Nginx container: ${startError.message}`);
            //     return;
            //   }
            //   console.log("Nginx container restarted with new config.");
            // });
            exec(
                `docker-compose -f ${nginxComposePath} down --volumes && docker-compose -f ${nginxComposePath} up --build -d`,
                (composeRestartError) => {
                  if (composeRestartError) {
                    console.error(`Failed to restart container with new networks: ${composeRestartError.message}`);
                    return;
                  }
                  console.log(`Nginx container restarted with new network for ${instanceName}`);
                  res.send(
                    `Instance ${instanceName} creation started. Check /status/${instanceName} for progress.`
                  );
                }
              );
        //   });
        // });

        // exec(`docker cp ${hostNginxPath} nginx:/etc/nginx/conf.d/default.conf`, (error) => {
        //   if (error) {
        //     console.error(`Failed to copy Nginx config: ${error.message}`);
        //     return;
        //   }
        //   console.log("Copied to nginx")
        
        //   // // Reload Nginx configuration inside the container
        //   // exec(`docker exec nginx nginx -s reload`, (reloadError) => {
        //   //   if (reloadError) {
        //   //     console.error(`Failed to reload Nginx: ${reloadError.message}`);
        //   //     return;
        //   //   }
        
        //     // Now restart the Nginx container with updated Docker Compose
        //     exec(
        //       `docker-compose -f ${nginxComposePath} down && docker-compose -f ${nginxComposePath} up -d`,
        //       (composeRestartError) => {
        //         if (composeRestartError) {
        //           console.error(`Failed to restart container with new networks: ${composeRestartError.message}`);
        //           return;
        //         }
        //         console.log(`Nginx container restarted with new network for ${instanceName}`);
        //         res.send(
        //           `Instance ${instanceName} creation started. Check /status/${instanceName} for progress.`
        //         );
        //       }
        //     );
        //   });

        // });
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
          .send(`Error fetching status for ${instanceName}: ${error.message}`);
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

        res.json({ instance: instanceName, containers: statusResponse });
      } else {
        res.status(404).send(`No containers found for ${instanceName}`);
      }
    }
  );
});

module.exports = router;

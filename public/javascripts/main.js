const BASE_URL = "http://rafiki-launchpad.devligence.com";

const getOrCreateToken = async () => {
  let token = localStorage.getItem("rafikiLaunchPadToken");

  if (!token) {
    // Request new token from the backend
    const response = await fetch(`${BASE_URL}/api/get-new-token`, {
      method: "POST",
    });
    const data = await response.json();
    token = data.token;

    // Store in localStorage for persistence
    localStorage.setItem("rafikiLaunchPadToken", token);
  }

  return token;
};

const fetchInstances = async () => {
  const token = await getOrCreateToken();

  const response = await fetch(`${BASE_URL}/api/get-instances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(response);
  if (response.ok) {
    // const data = await response.json();
    
    // return data.instances;

    const data = await response.json();
    console.log("User Instances:", data.instances);
    const instances = data.instances;


    // Populate the table body
    const tableBody = document.querySelector('#search-table tbody');
    tableBody.innerHTML = ''; // Clear previous rows

    // Sort the instances by created_at (most recent first)
    instances.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));


    instances.forEach((instance) => {

      const validDate = instance.created_at.split('.')[0] + 'Z';
      const formattedDate = new Date(validDate).toLocaleString();

      const row = `
      <tr>
        <td class="dark:text-white">${instance.id}</td>
        <td
          class="font-medium text-gray-900 whitespace-nowrap dark:text-white"
        >
          ${instance.instance_name}
        </td>
        <td class="dark:text-white">
          <a href="http://${instance.admin_api}/graphql" target="_blank">http://${instance.admin_api}/graphql</a>
        </td>
        <td class="dark:text-white">${formattedDate}</td>
        <td class="dark:text-white">${instance.status.toUpperCase()}</td>
      </tr>
    `;
      tableBody.insertAdjacentHTML('beforeend', row);
    });

    // Reinitialize DataTable
    if (typeof simpleDatatables.DataTable !== 'undefined') {
      const dataTable = new simpleDatatables.DataTable('#search-table', {
        searchable: true,
        sortable: false,
      });

      // Optional: Add event listeners or callbacks as needed
      dataTable.on('datatable.init', () => {
        console.log('DataTable initialized with dynamic data');
      });
      document.getElementById("table-header").style.backgroundColor='#64aeaa';
    }

  } else {
    console.log(response);
    console.error("Failed to fetch instances");
  }


};
fetchInstances();

const BASE_URL = "http://rafiki-launchpad.devligence.com";


  // Function to update summary based on form input
  function updateSummary() {
    const instanceNameElement = document.getElementById('instanceName');
    instanceNameElement
    const instanceName = document.getElementById('instanceName').value;
    const instanceWebhook = document.getElementById('instanceWebhookURL').value;
    const instanceExchangeRateUrl = document.getElementById('instanceExchangeRateURL').value;

    const regex = /^[a-zA-Z]+[a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)*$/;
    const errorMessage = document.getElementById("error-message");
    const submit_button = document.getElementById('createInstanceButton');

    
    if (regex.test(instanceName)) {
        instanceNameElement.classList.remove("border-red-600");
        instanceNameElement.classList.add("border-gray-300");
        errorMessage.classList.add("hidden");
        submit_button.disabled = false

        document.getElementById('summary-instance-name').textContent = instanceName || '-';
        document.getElementById('summary-instance-webhook').textContent = instanceWebhook || '-';
        document.getElementById('summary-instance-exchange-rate-url').textContent = instanceExchangeRateUrl || '-';
    } else {
        instanceNameElement.classList.remove("border-gray-300");
        instanceNameElement.classList.add("border-red-600");
        errorMessage.classList.remove("hidden");
        submit_button.disabled = true
    }


}
// Handle the create button click
document.getElementById('createInstanceButton').addEventListener('click', function () {
    const submit_button = document.getElementById('createInstanceButton');
    let token = localStorage.getItem("rafikiLaunchPadToken");
    if (!token) {
        console.error("Failed to create instance");
    }
    const form = document.getElementById('instanceForm');
    const formData = new FormData(form);

    // Collect the form data and prepare it for sending
    const instanceData = {};
    formData.forEach((value, key) => {
        instanceData[key] = value;
    });

    submit_button.innerHTML='Creating Instance...'
    submit_button.disabled=true
    // Send the instance data (example: use fetch to call the backend endpoint)
    fetch(`${BASE_URL}/api/create-instance`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(instanceData),
    })
    .then(response => {
        return response.json()
    })
    .then(data => {
        console.log(data)
        submit_button.innerHTML='Complete'
        submit_button.disabled = false
        if(data.status!=200){
            showToast(`Error! ${data.message}`,'error');
            console.log(data.message)
            setTimeout(() => {
                location.reload()
            }, 10000);
        }else{
            showToast(`${data.message}`,'success');
            setTimeout(() => {
                window.location.href='/'
            }, 2000);
        }
       

    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to create instance.');
    });
});


function showToast(message,toast_type) {
    const toast = document.getElementById(`toast-${toast_type}`);
    const toastMessage = document.getElementById(`toast-message-${toast_type}`);
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    
    // Automatically hide the toast after 3 seconds
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

document.getElementById('toast-close').addEventListener('click', function() {
    document.getElementById('toast').classList.add('hidden');
});
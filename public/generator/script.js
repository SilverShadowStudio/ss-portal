

// Net Days

document.addEventListener("DOMContentLoaded", function () {
    const invoiceInputDate = document.getElementById("invoiceInputDate");
    const netDaysInput = document.getElementById("netDays");


    function calculateDueDate() {
        const invoiceDate = new Date(invoiceInputDate.value);
        const netDays = parseInt(netDaysInput.value || "0", 10);

        if (!isNaN(invoiceDate.getTime()) && !isNaN(netDays)) {
            const dueDate = new Date(invoiceDate);
            dueDate.setDate(dueDate.getDate() + netDays);

            const formattedDueDate = dueDate.toISOString().split("T")[0]; // YYYY-MM-DD

            // Store to localStorage
            localStorage.setItem("netDays", netDays);
            localStorage.setItem("dueDate2", formattedDueDate);


            // Ensure hidden field exists
            let dueDateInput = document.getElementById("dueDate2");
            if (!dueDateInput) {
                dueDateInput = document.createElement("input");
                dueDateInput.type = "hidden";
                dueDateInput.id = "dueDate2";
                document.body.appendChild(dueDateInput);
            }
            dueDateInput.value = formattedDueDate;
        }
    }

    // Listen for changes
    invoiceInputDate.addEventListener("change", calculateDueDate);
    netDaysInput.addEventListener("change", calculateDueDate);

    // Run on load
    calculateDueDate();
});












// FORM , SAVE INVOICE ITEMS

document.addEventListener('DOMContentLoaded', function() {
    // Add new item when the "Add Item" button is clicked
    document.getElementById('addItem').addEventListener('click', function() {
        let container = document.getElementById('itemsContainer');

        let newItem = document.createElement('div');
        newItem.classList.add('item');
        newItem.innerHTML = `
            <label> Category: </label>
            <input type="text" name="description[]" required>

            <label> Item:</label>
            <input type="text" name="quotation[]" required>

            <label>Price:</label>
            <input type="number" name="price[]" step="0.01" required>

            <button type="button" class="removeItem">❌</button>
        `;
        container.appendChild(newItem);
    });

    // Event delegation to handle remove button clicks
    document.getElementById('itemsContainer').addEventListener('click', function(event) {
        if (event.target && event.target.classList.contains('removeItem')) {
            // Remove the item
            event.target.parentElement.remove();
        }
    });

    // Save invoice items when the form is submitted
    document.getElementById('itemsForm').addEventListener('submit', function(event) {
        event.preventDefault();

        // Get all input values for descriptions, quotations, and prices
        let descriptions = document.querySelectorAll('input[name="description[]"]');
        let quotations = document.querySelectorAll('input[name="quotation[]"]');
        let prices = document.querySelectorAll('input[name="price[]"]');

        // Store the items in an array
        let invoiceItems = [];
        descriptions.forEach((desc, index) => {
            invoiceItems.push({
                description: desc.value,
                quotation: quotations[index].value,
                price: parseFloat(prices[index].value)
            });
        });

        // Store invoice items in localStorage
        localStorage.setItem("invoiceItems", JSON.stringify(invoiceItems));

        console.log("Invoice Items:", invoiceItems); // Log the items
        alert("Items saved!");
    });
});






// DISPLAY; OTHER PAGE

document.addEventListener("DOMContentLoaded", function () {

    // Shorten invoicedate 2
    function formatDate(dateString) {
        if (!dateString) return "N/A"; // Return "N/A" if date is empty
        let dateObj = new Date(dateString);
        if (isNaN(dateObj)) return dateString; // If the date is invalid, return original value
        return dateObj.toLocaleDateString("en-US", { day: "numeric", month: "short" }); // Example: "7 Mar"
    }

    // Retrieve each item separately (NO JSON.parse!)
    document.getElementById("clientName").innerText = localStorage.getItem("client") || "N/A";
    document.getElementById("clientAddress").innerText = localStorage.getItem("address") || "N/A";
    document.getElementById("clientContact").innerText = localStorage.getItem("contact") || "N/A";
    document.getElementById("projectName").innerText = localStorage.getItem("project") || "N/A";
    document.getElementById("invoiceDate1").innerText = localStorage.getItem("invoiceDate") || "N/A";
    document.getElementById("invoiceDate3").innerText = localStorage.getItem("invoiceDate") || "N/A";
    document.getElementById("invoiceDate2").innerText = formatDate(localStorage.getItem("invoiceDate")); // Only this one is formatted
    document.getElementById("invoiceNumber").innerText = localStorage.getItem("invoiceNumber") || "N/A";
    document.getElementById("invoiceInputDate").innerText = localStorage.getItem("invoiceInputDate") || "N/A";
    document.getElementById("dueDate2").innerText = localStorage.getItem("dueDate2") || "N/A";
    document.getElementById("bankName").innerText = localStorage.getItem("bank") || "N/A";
    document.getElementById("sortCode").innerText = localStorage.getItem("sortCode") || "N/A";
    document.getElementById("accountNumber").innerText = localStorage.getItem("accountNumber") || "N/A";
    document.getElementById("swiftCode").innerText = localStorage.getItem("swift") || "N/A";
    document.getElementById("ibanNumber").innerText = localStorage.getItem("iban") || "N/A";
});


// Changes the file name

window.addEventListener("DOMContentLoaded", function () {
    const invoiceNumber = localStorage.getItem("invoiceNumber") || "N/A";

    // Get current filename from the URL
    const fileName = window.location.pathname.split("/").pop();

    // Set suffix based on which file is loaded
    let suffix = "-A";
    if (fileName === "display2.html") {
      suffix = "-B";
    }

    // Set the title
    document.title = `Silvershadow Studio - Invoice ${invoiceNumber}${suffix}`;
  });





// THE DYNAMIC PART

document.addEventListener('DOMContentLoaded', function() {
    // Retrieve and display saved invoice items
    let savedInvoiceItems = JSON.parse(localStorage.getItem("invoiceItems")) || [];
    let itemsTable = document.getElementById("invoiceItems").getElementsByTagName('tbody')[0]; // Select tbody

    let totalPrice = 0;

    // Display each saved item in a table row
    savedInvoiceItems.forEach(item => {
        let row = document.createElement("tr");
        row.innerHTML = `
            <td> ${item.description}</td>
            <td> ${item.quotation}</td>
            <td> <strong> ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0  }).format(parseFloat(item.price) || 0)} </strong></td>
        `;
        itemsTable.appendChild(row);

        // Add to total price
        totalPrice += parseFloat(item.price) || 0;
    }); 

    // If no items are saved, display a message
    if (savedInvoiceItems.length === 0) {
        let row = document.createElement("tr");
        row.innerHTML = "<td colspan='3'>No invoice items saved.</td>";
        itemsTable.appendChild(row);
    }












// THE VAT AND CALCULATIONS

// Function to calculate and update invoice totals
function calculateTotals() {
    // Get VAT rate from localStorage (default to 20%)
    let vatRate = parseFloat(localStorage.getItem("vatRate") || 20) / 100;
    document.getElementById("vatRateDisplay").innerText = (vatRate * 100).toFixed(1); // Update VAT display

     // Get Downpayment rate from localStorage (default to 40%)
    let down = parseFloat(localStorage.getItem("down") || 40) / 100;
    document.getElementById("downpaymentDisplay").innerText = (down * 100).toFixed(1); // Update Downpayment display

    

    let vatAmount = totalPrice * vatRate;
    let grandTotal = totalPrice + vatAmount;
    let downpayment = grandTotal * down;
    let remainingBalance = grandTotal - downpayment; 

    // Formatter to remove decimal places
    let currencyFormatter = new Intl.NumberFormat('en-GB', { 
        style: 'currency', 
        currency: 'GBP', 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 0 
    });

    // Update the HTML values without ".00"
    document.getElementById("totalPrice").innerText = currencyFormatter.format(totalPrice);
    document.getElementById("vatAmount").innerText = currencyFormatter.format(vatAmount);
    document.getElementById("grandTotal").innerText = currencyFormatter.format(grandTotal);
    document.getElementById("downpayment").innerText = currencyFormatter.format(downpayment);
    document.getElementById("remainingBalance").innerText = currencyFormatter.format(remainingBalance);
}


    // Run on the invoice summary page
    calculateTotals();
});




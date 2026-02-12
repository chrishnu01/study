module.exports = function generateQuotationTemplateSale(data) {
  const {
    clientName,
    siteName,
    date,
    items,
    gstPercentage,
    totalBeforeGST,
    totalGST,
    totalAfterGST,
    daysRsInAdvanceDays,
    daysRsInAdvanceText,
    termsAndConditions,
    uM,
    weight,
    loadingCharges,
    freitCharges
  } = data;

  return `
  <html>
  <head>
    <style>
      body {
        font-family: Arial, sans-serif;
        font-size: 10px;
        color: #000;
        margin: 0;
        padding: 0;
      }
      .container {
        width: 95%;
        margin: 20px auto;
        border: 2px solid #000;
        padding: 15px 0px;
      }
        .container > * {
  margin-left: 20px;
  margin-right: 20px;
}
.container > table {
  margin-left: 20px;
  margin-right: 0;
}

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 5px;
      }
      .header-left img {
        width: 80px;
      }
      .header-center {
        text-align: center;
        flex-grow: 1;

      }
      .header-center h2 {
        margin: 0;
        font-size: 18px;
      }
      .header-center p {
        margin: 2px 0;
        font-size: 10px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
        font-size: 9px;
      }
        table {
  width: calc(100% - 40px); /* subtract the container's horizontal margins */
  border-collapse: collapse;
  margin-top: 10px;
  font-size: 9px;
}

      th, td {
        border: 1px solid #000;
        padding: 5px;
        text-align: center;
      }
      th {
        background-color: #f0f0f0;
      }
      .terms {
        margin-top: 15px;
        font-size: 9px;
      }
      .terms ol li {
        margin-bottom: 4px;
      }
      .footer {
        margin-top: 20px;
        text-align: left;
      }
      .footer p {
        margin: 2px 0;
      }
      .total {
        margin-top: 10px;
        text-align: right;
      }

     .footer {
  text-align: center;
  margin-top: 20px;
}

.header-left {
  text-align: left;
}

.footer-left {
  text-align: left;
   margin-bottom: 20px;
}

.header-center {
  text-align: center;
  margin: 5px 0;
}

.footer-right {
  text-align: right;
}
.account-details p {
  margin: 5px 0;
  text-align: right; /* center each line */
}
.account-details {
  margin: 5px 0;
  text-align: right; /* center each line */
}
      .text-right {
        text-align: right !important;
      }

    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="header-left">
          <img src="https://mangal-crm.s3.ap-south-1.amazonaws.com/ManglaCRM/1764748244013_logo.jpg" alt="Company Logo" />
        </div>
        <div class="header-center">
          <h2>OM SCAFFOLDERS</h2>
          <p>VILLAGE KURANWALA, DERABASSI- BARWALA ROAD,</p>
          <p>DERABASSI, PUNJAB-140507</p>
          <p>GSTIN: 03AACFO0944R1Z2</p>
          <p>Contact: 7508186009</p>
        </div>
      </div>
      <hr>

      <p class="header-left"><strong>Date:</strong> ${new Date(date).toLocaleDateString("en-GB")}</p>
      <p><strong>M/S: ${clientName}</strong></p>
      <p><strong>Site: ${siteName}</strong></p>

      <p>Dear Sir,</p>
      <p>Please find below our best rates for sales purpose:</p>

      <table>
        <thead>
          <tr>
            <th>Sr. No</th>
            <th>Item</th>
            <th>Size</th>
            <th>Approx Weight in Kg.</th>
            <th>Qty</th>
            <th>UOM</th>
            <th>Rate/Rs</th>
            <th>Unit</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${item.item || ""}</td>
              <td>${item.size || ""}</td>
              <td>${item.weight || 0}</td>
              <td>${item.quantity || 0}</td>
              <td>${item.uom || ""}</td>
              <td>${item.rate || 0}</td>
              <td>${item.unit || ""}</td>
              <td class="text-right">${item.amount || 0}</td>
            </tr>`).join('')}
        </tbody>

         <tfoot>
    <tr>
      <td colspan="8" style="text-align:left; font-weight:bold;">Loading Charges:</td>
      <td class="text-right"><strong>₹${loadingCharges}</strong></td>
    </tr>

    <tr>
      <td colspan="8" style="text-align:left; font-weight:bold;">Freit Charges:</td>
      <td class="text-right"><strong>₹${freitCharges}</strong></td>
    </tr>

    <tr>
      <td colspan="8" style="text-align:left; font-weight:bold;">Total Before GST:</td>
      <td class="text-right"><strong>₹${totalBeforeGST}</strong></td>
    </tr>

    <tr>
      <td colspan="8" style="text-align:left; font-weight:bold;">GST (${gstPercentage}%):</td>
      <td class="text-right"><strong>₹${totalGST}</strong></td>
    </tr>

    <tr>
      <td colspan="8" style="text-align:left; font-weight:bold; background:#f8f8f8;">Total After GST:</td>
      <td class="text-right" style="background:#f8f8f8;"><strong>₹${totalAfterGST}</strong></td>
    </tr>
  </tfoot>
      </table>

    

      ${Array.isArray(termsAndConditions) && termsAndConditions.length > 0
      ? `
          <div class="terms">
            <h3>TERMS & CONDITIONS</h3>
            <ol>
              ${termsAndConditions.map(term => `<li>${term}</li>`).join('')}
            </ol>
          </div>
          `
      : ""
    }

      <div class="footer">
  <p class="footer-left">For OM Scaffolders</p>
  <p class="header-left"><strong>Auth. Signatory</strong></p>
  
  <p class="account-details">BANK DETAIL:- <strong>OM SCAFFOLDERS</strong></p>
  <!-- Account details each on a separate row -->
  <div class="account-details">
  <p>BRANCH – <strong>Federal Bank, Sector 8, Chandigarh</strong></p>
    <p>A/C NO- <strong>13735600003913</strong></p>
    <p>IFSC- <strong>FDRL0001373</strong></p>
  </div>
</div>

    </div>
  </body>
  </html>
  `;
};

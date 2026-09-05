let ADMIN_PASSWORD = "";

export default {
  async fetch(request, env) {
    ADMIN_PASSWORD = env.ADMIN_PASSWORD;
    const url = new URL(request.url);

    try {
      // =========================
      // CUSTOMER PAGE
      // =========================
      if (request.method === "GET" && url.pathname === "/") {
        return html(customerPage());
      }

      // =========================
      // ADMIN PAGE
      // =========================
      if (request.method === "GET" && url.pathname === "/admin") {
        return html(adminPage());
      }

      // =========================
      // ADMIN LOGIN CHECK
      // =========================
      if (request.method === "POST" && url.pathname === "/api/admin/login") {
        const body = await request.json();

        if (body.password !== ADMIN_PASSWORD) {
          return json({ success: false, error: "Invalid password" }, 401);
        }

        return json({
          success: true,
          token: ADMIN_PASSWORD
        });
      }

      // =========================
      // REGISTER WARRANTY
      // =========================
      if (request.method === "POST" && url.pathname === "/api/register") {
        const form = await request.formData();

        const name = clean(form.get("name"));
        const email = clean(form.get("email"));
        const phone = clean(form.get("phone"));
        const country = clean(form.get("country"));
        const address = clean(form.get("address"));
        const product = clean(form.get("product"));
        const model = clean(form.get("model"));
        const serial = clean(form.get("serial"));
        const purchaseDate = clean(form.get("purchase_date"));
        const store = clean(form.get("store"));
        const invoice = clean(form.get("invoice"));

        if (
          !name ||
          !email ||
          !phone ||
          !country ||
          !product ||
          !model ||
          !serial ||
          !purchaseDate
        ) {
          return json(
            { success: false, error: "Please complete all required fields." },
            400
          );
        }

        const id = crypto.randomUUID();
        const registeredAt = new Date().toISOString();

        let receiptKey = null;
        const receipt = form.get("receipt");

        if (receipt && typeof receipt === "object" && receipt.size > 0) {
          if (receipt.size > 10 * 1024 * 1024) {
            return json(
              { success: false, error: "Receipt file must be below 10MB." },
              400
            );
          }

          const originalName = receipt.name || "receipt";
          const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");

          receiptKey = `receipts/${id}-${safeName}`;

          await env.BUCKET.put(receiptKey, receipt, {
            httpMetadata: {
              contentType: receipt.type || "application/octet-stream"
            }
          });
        }

        await env.DB.prepare(`
          INSERT INTO registrations (
            id,
            name,
            email,
            phone,
            country,
            address,
            product,
            model,
            serial,
            purchase_date,
            store,
            invoice,
            receipt_key,
            status,
            registered_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            id,
            name,
            email,
            phone,
            country,
            address,
            product,
            model,
            serial,
            purchaseDate,
            store,
            invoice,
            receiptKey,
            "Active",
            registeredAt
          )
          .run();

        return json({
          success: true,
          message: "Warranty registration successful.",
          id
        });
      }

      // =========================
      // GET REGISTRATIONS
      // =========================
      if (request.method === "GET" && url.pathname === "/api/registrations") {
        if (!authorized(request)) {
          return json({ error: "Unauthorized" }, 401);
        }

        const search = url.searchParams.get("search") || "";

        let result;

        if (search) {
          const keyword = `%${search}%`;

          result = await env.DB.prepare(`
            SELECT *
            FROM registrations
            WHERE
              name LIKE ?
              OR email LIKE ?
              OR phone LIKE ?
              OR serial LIKE ?
              OR model LIKE ?
              OR product LIKE ?
            ORDER BY registered_at DESC
          `)
            .bind(
              keyword,
              keyword,
              keyword,
              keyword,
              keyword,
              keyword
            )
            .all();
        } else {
          result = await env.DB.prepare(`
            SELECT *
            FROM registrations
            ORDER BY registered_at DESC
          `).all();
        }

        return json({
          success: true,
          registrations: result.results
        });
      }

      // =========================
      // UPDATE STATUS
      // =========================
      if (
        request.method === "PATCH" &&
        url.pathname.startsWith("/api/registrations/")
      ) {
        if (!authorized(request)) {
          return json({ error: "Unauthorized" }, 401);
        }

        const id = url.pathname.split("/").pop();
        const body = await request.json();

        const status =
          body.status === "Inactive" ? "Inactive" : "Active";

        await env.DB.prepare(`
          UPDATE registrations
          SET status = ?
          WHERE id = ?
        `)
          .bind(status, id)
          .run();

        return json({
          success: true
        });
      }

      // =========================
      // VIEW RECEIPT
      // =========================
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/receipt/")
      ) {
        if (!authorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const id = url.pathname.split("/").pop();

        const record = await env.DB.prepare(`
          SELECT receipt_key
          FROM registrations
          WHERE id = ?
        `)
          .bind(id)
          .first();

        if (!record || !record.receipt_key) {
          return new Response("Receipt not found", { status: 404 });
        }

        const object = await env.BUCKET.get(record.receipt_key);

        if (!object) {
          return new Response("Receipt not found", { status: 404 });
        }

        const headers = new Headers();

        object.writeHttpMetadata(headers);
        headers.set("Cache-Control", "private, max-age=3600");

        return new Response(object.body, {
          headers
        });
      }

      return new Response("Not Found", { status: 404 });

    } catch (error) {
      console.error(error);

      return json(
        {
          success: false,
          error: "Server error"
        },
        500
      );
    }
  }
};


// ==========================================
// HELPERS
// ==========================================

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function authorized(request) {
  const auth = request.headers.get("Authorization");

  if (!auth) return false;

  const token = auth.replace("Bearer ", "");

  return token === ADMIN_PASSWORD;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8"
    }
  });
}

function html(content) {
  return new Response(content, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8"
    }
  });
}


// ==========================================
// CUSTOMER HTML
// ==========================================

function customerPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>LULU8055 Warranty Registration</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, Helvetica, sans-serif;
  background: #f5f5f5;
  color: #111;
}

.header {
  background: #111;
  color: white;
  padding: 28px 20px;
  text-align: center;
}

.logo {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 2px;
}

.container {
  max-width: 720px;
  margin: 35px auto;
  padding: 0 18px;
}

.card {
  background: white;
  border-radius: 16px;
  padding: 30px;
  box-shadow: 0 5px 25px rgba(0,0,0,.08);
}

h1 {
  margin-top: 0;
  font-size: 28px;
}

.subtitle {
  color: #666;
  margin-bottom: 30px;
}

.section {
  margin-top: 28px;
  margin-bottom: 15px;
  font-size: 18px;
  font-weight: 700;
}

label {
  display: block;
  margin-top: 16px;
  margin-bottom: 7px;
  font-weight: 600;
}

input,
textarea,
select {
  width: 100%;
  padding: 13px;
  border: 1px solid #ccc;
  border-radius: 9px;
  font-size: 16px;
}

textarea {
  min-height: 90px;
  resize: vertical;
}

.required {
  color: #d00;
}

button {
  width: 100%;
  margin-top: 25px;
  padding: 15px;
  border: 0;
  border-radius: 10px;
  background: #111;
  color: white;
  font-size: 17px;
  font-weight: 700;
}

button:disabled {
  opacity: .5;
}

.message {
  margin-top: 20px;
  padding: 15px;
  border-radius: 9px;
  display: none;
}

.success {
  display: block;
  background: #e8f7e8;
  color: #146214;
}

.error {
  display: block;
  background: #ffeaea;
  color: #a00000;
}

.footer {
  text-align: center;
  color: #777;
  padding: 30px;
  font-size: 13px;
}

@media(max-width:600px) {
  .card {
    padding: 20px;
  }

  h1 {
    font-size: 24px;
  }
}
</style>
</head>

<body>

<div class="header">
  <div class="logo">LULU8055</div>
  <div>Warranty Registration</div>
</div>

<div class="container">

<div class="card">

<h1>Warranty Registration</h1>

<div class="subtitle">
Register your LULU8055 product warranty online.
</div>

<form id="form" enctype="multipart/form-data">

<div class="section">Customer Information</div>

<label>
Full Name <span class="required">*</span>
</label>
<input name="name" required>

<label>
Email <span class="required">*</span>
</label>
<input type="email" name="email" required>

<label>
Phone <span class="required">*</span>
</label>
<input name="phone" required>

<label>
Country <span class="required">*</span>
</label>
<input name="country" value="Singapore" required>

<label>
Address
</label>
<textarea name="address"></textarea>


<div class="section">Product Information</div>

<label>
Product <span class="required">*</span>
</label>
<input name="product" required>

<label>
Model <span class="required">*</span>
</label>
<input name="model" required>

<label>
Serial Number <span class="required">*</span>
</label>
<input name="serial" required>

<label>
Purchase Date <span class="required">*</span>
</label>
<input type="date" name="purchase_date" required>

<label>
Place of Purchase
</label>
<input name="store">

<label>
Invoice Number
</label>
<input name="invoice">

<label>
Purchase Receipt
</label>
<input
  type="file"
  name="receipt"
  accept="image/*,.pdf"
>

<button id="submitBtn" type="submit">
Submit Warranty Registration
</button>

<div id="message" class="message"></div>

</form>

</div>

</div>

<div class="footer">
© 2026 LULU8055. All rights reserved.
</div>

<script>

const form = document.getElementById("form");
const btn = document.getElementById("submitBtn");
const message = document.getElementById("message");

form.addEventListener("submit", async function(e) {

  e.preventDefault();

  btn.disabled = true;
  btn.textContent = "Submitting...";

  message.className = "message";
  message.style.display = "none";

  try {

    const formData = new FormData(form);

    const response = await fetch("/api/register", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Registration failed.");
    }

    message.className = "message success";
    message.textContent =
      "✓ Warranty registration successful. Thank you.";

    form.reset();

  } catch(error) {

    message.className = "message error";
    message.textContent =
      "Registration failed: " + error.message;

  } finally {

    btn.disabled = false;
    btn.textContent = "Submit Warranty Registration";

  }

});

</script>

</body>
</html>`;
}


// ==========================================
// ADMIN HTML
// ==========================================

function adminPage() {
  return `<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width, initial-scale=1.0">

<title>LULU8055 Admin</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, Helvetica, sans-serif;
  background: #f4f4f4;
  color: #111;
}

.header {
  background: #111;
  color: white;
  padding: 20px;
}

.logo {
  font-size: 25px;
  font-weight: 800;
}

.container {
  max-width: 1200px;
  margin: 25px auto;
  padding: 0 15px;
}

.card {
  background: white;
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 20px;
}

input,
select {
  padding: 11px;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-size: 15px;
}

button {
  padding: 11px 18px;
  border: 0;
  border-radius: 8px;
  background: #111;
  color: white;
  font-weight: 700;
}

.login {
  max-width: 400px;
  margin: 100px auto;
}

.login input {
  width: 100%;
  margin: 10px 0;
}

.login button {
  width: 100%;
}

.search {
  display: flex;
  gap: 10px;
}

.search input {
  flex: 1;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 20px;
}

th,
td {
  padding: 12px 8px;
  border-bottom: 1px solid #ddd;
  text-align: left;
  vertical-align: top;
}

th {
  background: #f5f5f5;
}

.badge {
  padding: 5px 9px;
  border-radius: 20px;
  background: #e7f6e7;
  color: #176517;
  font-size: 12px;
}

@media(max-width:800px) {

  .search {
    flex-direction: column;
  }

  table {
    font-size: 12px;
  }

  th,
  td {
    padding: 8px 5px;
  }

}

</style>

</head>

<body>

<div id="app"></div>

<script>

let token = sessionStorage.getItem("lulu8055_admin");

function showLogin() {

  document.getElementById("app").innerHTML = \`
    <div class="login card">

      <h2>LULU8055 Admin</h2>

      <p>Warranty Registration Management</p>

      <input
        id="password"
        type="password"
        placeholder="Admin Password"
      >

      <button onclick="login()">
        Login
      </button>

      <p id="error"></p>

    </div>
  \`;

}

async function login() {

  const password =
    document.getElementById("password").value;

  const response = await fetch(
    "/api/admin/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password })
    }
  );

  const data = await response.json();

  if (!data.success) {

    document.getElementById("error").textContent =
      "Invalid password.";

    return;

  }

  sessionStorage.setItem(
    "lulu8055_admin",
    data.token
  );

  token = data.token;

  showDashboard();

}

async function loadData(search = "") {

  const response = await fetch(
    "/api/registrations?search=" +
    encodeURIComponent(search),
    {
      headers: {
        Authorization: "Bearer " + token
      }
    }
  );

  if (response.status === 401) {

    sessionStorage.removeItem("lulu8055_admin");

    showLogin();

    return;

  }

  const data = await response.json();

  renderTable(data.registrations || []);

}

function showDashboard() {

  document.getElementById("app").innerHTML = \`

  <div class="header">

    <div class="logo">
      LULU8055 Admin
    </div>

  </div>

  <div class="container">

    <div class="card">

      <h2>Warranty Registrations</h2>

      <div class="search">

        <input
          id="search"
          placeholder="Search name, email, phone, serial..."
          onkeyup="searchData()"
        >

        <button onclick="loadData()">
          Refresh
        </button>

        <button onclick="logout()">
          Logout
        </button>

      </div>

    </div>

    <div class="card">

      <div id="table">
        Loading...
      </div>

    </div>

  </div>

  \`;

  loadData();

}

function searchData() {

  const value =
    document.getElementById("search").value;

  loadData(value);

}

function renderTable(rows) {

  if (!rows.length) {

    document.getElementById("table").innerHTML =
      "<p>No registrations found.</p>";

    return;

  }

  let html = \`

  <div style="overflow-x:auto">

  <table>

  <thead>

  <tr>

    <th>Name</th>
    <th>Contact</th>
    <th>Product</th>
    <th>Serial</th>
    <th>Purchase</th>
    <th>Store</th>
    <th>Status</th>
    <th>Receipt</th>

  </tr>

  </thead>

  <tbody>

  \`;

  for (const row of rows) {

    html += \`

    <tr>

      <td>
        <strong>\${escapeHtml(row.name)}</strong><br>
        \${escapeHtml(row.country)}
      </td>

      <td>
        \${escapeHtml(row.email)}<br>
        \${escapeHtml(row.phone)}
      </td>

      <td>
        \${escapeHtml(row.product)}<br>
        \${escapeHtml(row.model)}
      </td>

      <td>
        \${escapeHtml(row.serial)}
      </td>

      <td>
        \${escapeHtml(row.purchase_date)}
      </td>

      <td>
        \${escapeHtml(row.store || "-")}<br>
        \${escapeHtml(row.invoice || "")}
      </td>

      <td>

        <select
          onchange="changeStatus(
            '\${row.id}',
            this.value
          )"
        >

          <option
            value="Active"
            \${row.status === "Active" ? "selected" : ""}
          >
            Active
          </option>

          <option
            value="Inactive"
            \${row.status === "Inactive" ? "selected" : ""}
          >
            Inactive
          </option>

        </select>

      </td>

      <td>

        \${
          row.receipt_key
          ? \`
            <a
              href="/api/receipt/\${row.id}"
              target="_blank"
              onclick="return openReceipt(event, '\${row.id}')"
            >
              View
            </a>
          \`
          : "-"
        }

      </td>

    </tr>

    \`;

  }

  html += \`

  </tbody>

  </table>

  </div>

  \`;

  document.getElementById("table").innerHTML = html;

}

async function changeStatus(id, status) {

  await fetch(
    "/api/registrations/" + id,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ status })
    }
  );

}

function openReceipt(event, id) {

  event.preventDefault();

  const url =
    "/api/receipt/" +
    id +
    "?token=" +
    encodeURIComponent(token);

  window.open(url, "_blank");

  return false;

}

function logout() {

  sessionStorage.removeItem(
    "lulu8055_admin"
  );

  token = null;

  showLogin();

}

function escapeHtml(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}

if (token) {

  showDashboard();

} else {

  showLogin();

}

</script>

</body>

</html>`;
}

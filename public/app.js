const $ = s => document.querySelector(s);
let currentUser = null;
let availableSlots = [];
let selectedSlotId = "";
let calendarStart = null;
let cachedAppointments = [];
let analyticsCharts = {};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c]));

async function api(url, options = {}) {
  const res = await fetch("/api" + url, {
    credentials: "same-origin",
    headers: {"Content-Type":"application/json", ...(options.headers || {})},
    ...options
  });
  const data = await res.json().catch(() => ({message:"Unexpected server response."}));
  if (!res.ok) throw new Error(data.message || "Request failed.");
  return data;
}
function showMessage(el, msg, ok = false) {
  if (el) el.innerHTML = `<span class="${ok ? "message-ok" : "message-error"}">${esc(msg)}</span>`;
}
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.remove("d-none");
  setTimeout(() => el.classList.add("d-none"), 3500);
}
function showLoginTab(register = false) {
  $("#loginForm").classList.toggle("d-none", register);
  $("#registerForm").classList.toggle("d-none", !register);
  $("#loginTab").classList.toggle("active", !register);
  $("#registerTab").classList.toggle("active", register);
  $("#authMessage").textContent = "";
}
function dateFromLocal(date) {
  const [y,m,d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
function dateKey(date) {
  const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,"0"), d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function todayLocal() { return dateKey(new Date()); }
function addDays(date, count) { const copy = new Date(date); copy.setDate(copy.getDate()+count); return copy; }
function prettyDate(date) { return dateFromLocal(date).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}); }
function statusTag(status) { return `<span class="status ${esc(status)}">${esc(status)}</span>`; }
function dateText(date) { return esc(date); }
function idOf(value) { if (!value) return ""; return typeof value === "string" ? value : String(value._id || value.id || ""); }
function isAdmin() { return currentUser?.role === "admin"; }
function isFaculty() { return currentUser?.role === "faculty"; }
function isStudent() { return currentUser?.role === "student"; }
function belongsToCurrentFaculty(appointment) { return idOf(appointment.providerId) === idOf(currentUser); }

$("#loginTab").onclick = () => showLoginTab(false);
$("#registerTab").onclick = () => showLoginTab(true);
$("#loginForm").onsubmit = async event => {
  event.preventDefault();
  try { await api("/auth/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.target)))}); await init(); }
  catch (error) { showMessage($("#authMessage"),error.message); }
};
$("#registerForm").onsubmit = async event => {
  event.preventDefault();
  try { await api("/auth/register",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.target)))}); await init(); }
  catch (error) { showMessage($("#authMessage"),error.message); }
};
$("#logoutBtn").onclick = async () => {
  try { await api("/auth/logout",{method:"POST"}); currentUser=null; selectedSlotId=""; await init(); }
  catch (error) { toast(error.message); }
};

async function init() {
  const {user} = await api("/auth/me"); currentUser=user;
  $("#authView").classList.toggle("d-none",!!user);
  $("#appView").classList.toggle("d-none",!user);
  $("#logoutBtn").classList.toggle("d-none",!user);
  $("#navUser").textContent=user ? user.name : "";
  if (!user) return;
  $("#welcomeTitle").textContent=`Hello, ${user.name.split(" ")[0]}`;
  $("#rolePill").textContent=user.role.toUpperCase();
  if (!["admin","faculty","student"].includes(user.role)) { toast("Your account has an unsupported role."); return; }
  $("#adminAnalytics").classList.toggle("d-none",!isAdmin());
  $("#studentPanel").classList.toggle("d-none",!isStudent());
  $("#staffPanel").classList.toggle("d-none",isStudent());
  $("#facultyCreateCard").classList.toggle("d-none",!isAdmin());
  $("#facultyPickerGroup").classList.toggle("d-none",!isAdmin());
  $("#facultySelect").required=isAdmin();
  $("#availabilityHeading").textContent=isAdmin()?"Manage faculty availability":"My availability";
  $("#availabilityDescription").textContent=isAdmin()?"Add available time slots for a faculty member.":"Add time slots when students can meet you.";
  $("#appointmentsHeading").textContent=isAdmin()?"All appointments":"My appointment requests";
  $("#appointmentsDescription").textContent=isAdmin()?"Oversee bookings across the college.":"Review requests for your own faculty schedule.";
  $("#dashboardDescription").textContent=isAdmin()?"Oversee faculty schedules and campus appointments.":isFaculty()?"Manage your availability and student appointment requests.":"Book a meeting with faculty and track your appointments.";
  $("#availabilityDate").min=todayLocal(); $("#slotDate").min=todayLocal();
  if (isAdmin()) { await loadFaculty(); await loadAllAppointments(); await loadStats(); }
  else if (isFaculty()) { setFacultyAvailability(); await loadAllAppointments(); await loadStats(); }
  else {
    $("#slotDate").value = $("#slotDate").value || todayLocal();
    calendarStart = dateFromLocal($("#slotDate").value);
    renderDateStrip(); await loadSlots(); await loadMine(); await loadNotifications(); await loadStats();
  }
}

/* Faculty/admin availability management */
async function loadFaculty() {
  const list=await api("/admin/faculty");
  $("#facultySelect").innerHTML='<option value="">Choose faculty</option>'+list.map(f=>`<option value="${esc(f._id)}">${esc(f.name)} · ${esc(f.department||"")}</option>`).join("");
}
function setFacultyAvailability() {
  $("#facultySelect").innerHTML=`<option value="${esc(idOf(currentUser))}">${esc(currentUser.name)}</option>`;
  $("#facultySelect").value=idOf(currentUser);
}
$("#facultyForm").onsubmit=async event=>{
  event.preventDefault();
  if(!isAdmin()){toast("Only administrators can create faculty accounts.");return;}
  try{
    const result=await api("/admin/faculty",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});
    showMessage($("#facultyMessage"),result.message,true);event.target.reset();await loadFaculty();
  }catch(error){showMessage($("#facultyMessage"),error.message);}
};
$("#availabilityForm").onsubmit=async event=>{
  event.preventDefault();
  if(!isAdmin()&&!isFaculty()){toast("You are not allowed to manage faculty availability.");return;}
  try{
    const data=Object.fromEntries(new FormData(event.target));
    if(isFaculty())data.providerId=idOf(currentUser);
    if(!data.providerId)throw new Error("Please select a faculty member.");
    if(data.endTime<=data.startTime)throw new Error("End time must be later than start time.");
    if(data.date<todayLocal())throw new Error("Please choose today or a future date.");
    const result=await api("/availability",{method:"POST",body:JSON.stringify(data)});
    showMessage($("#availabilityMessage"),result.message,true);event.target.reset();
    if(isFaculty())setFacultyAvailability();
    if(isAdmin())await loadFaculty();
  }catch(error){showMessage($("#availabilityMessage"),error.message);}
};

/* Visual calendar and slot filters */
function renderDateStrip() {
  const start=calendarStart || dateFromLocal($("#slotDate").value || todayLocal());
  $("#calendarMonth").textContent=start.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const selected=$("#slotDate").value;
  $("#dateStrip").innerHTML=Array.from({length:7},(_,i)=>{
    const date=addDays(start,i), key=dateKey(date), past=key<todayLocal();
    return `<button type="button" class="date-chip ${key===selected?"active":""}" data-date="${key}" ${past?"disabled":""}>
      <span class="day-label">${date.toLocaleDateString(undefined,{weekday:"short"})}</span>
      <span class="date-number">${date.getDate()}</span>
      <span class="day-label">${date.toLocaleDateString(undefined,{month:"short"})}</span>
    </button>`;
  }).join("");
  $("#dateStrip").querySelectorAll("[data-date]").forEach(button=>button.onclick=()=>selectDate(button.dataset.date));
}
function selectDate(date) {
  if(date<todayLocal()){toast("Past dates cannot be selected.");return;}
  $("#slotDate").value=date; selectedSlotId=""; renderDateStrip(); loadSlots();
}
$("#previousWeek").onclick=()=>{
  const candidate=addDays(calendarStart||dateFromLocal(todayLocal()),-7);
  calendarStart=candidate<dateFromLocal(todayLocal())?dateFromLocal(todayLocal()):candidate;
  renderDateStrip();
};
$("#nextWeek").onclick=()=>{calendarStart=addDays(calendarStart||dateFromLocal($("#slotDate").value||todayLocal()),7);renderDateStrip();};
$("#slotDate").onchange=()=>{
  if($("#slotDate").value<todayLocal()){$("#slotDate").value=todayLocal();toast("Past dates cannot be selected.");}
  calendarStart=dateFromLocal($("#slotDate").value);selectedSlotId="";renderDateStrip();loadSlots();
};
$("#departmentFilter").onchange=()=>{selectedSlotId="";renderSlotCards();};
$("#facultyFilter").onchange=()=>{selectedSlotId="";renderSlotCards();};

async function loadSlots() {
  const date=$("#slotDate").value, container=$("#slotCards");
  selectedSlotId=""; $("#confirmBookingBtn").disabled=true;
  if(!date){availableSlots=[];container.innerHTML='<div class="empty-slots">Choose a date to view available times.</div>';updateSelectionSummary();return;}
  container.innerHTML='<div class="empty-slots">Loading available times…</div>';
  try{
    availableSlots=await api("/availability?date="+encodeURIComponent(date));
    populateFilters();renderSlotCards();
  }catch(error){availableSlots=[];container.innerHTML='<div class="empty-slots">Could not load slots. Please refresh and try again.</div>';toast(error.message);}
}
function populateFilters(){
  const oldDept=$("#departmentFilter").value,oldFaculty=$("#facultyFilter").value;
  const departments=[...new Set(availableSlots.map(s=>s.providerId?.department).filter(Boolean))].sort();
  const faculties=[...new Map(availableSlots.filter(s=>s.providerId?._id).map(s=>[idOf(s.providerId),s.providerId])).values()].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  $("#departmentFilter").innerHTML='<option value="">All departments</option>'+departments.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join("");
  $("#facultyFilter").innerHTML='<option value="">All faculty</option>'+faculties.map(f=>`<option value="${esc(idOf(f))}">${esc(f.name)}</option>`).join("");
  if(departments.includes(oldDept))$("#departmentFilter").value=oldDept;
  if(faculties.some(f=>idOf(f)===oldFaculty))$("#facultyFilter").value=oldFaculty;
}
function filteredSlots(){
  const dept=$("#departmentFilter").value,faculty=$("#facultyFilter").value;
  return availableSlots.filter(slot=>(!dept||(slot.providerId?.department||"")===dept)&&(!faculty||idOf(slot.providerId)===faculty));
}
function renderSlotCards(){
  const slots=filteredSlots(),container=$("#slotCards");
  $("#slotCount").textContent=`${slots.length} available`;
  if(!slots.length){container.innerHTML='<div class="empty-slots">No available slots match these filters. Try another date or faculty.</div>';updateSelectionSummary();return;}
  container.innerHTML=slots.map(slot=>`<button type="button" class="slot-card ${idOf(slot)===selectedSlotId?"selected":""}" data-slot="${esc(idOf(slot))}">
    <span class="slot-time">${esc(slot.startTime)}–${esc(slot.endTime)}</span>
    <span class="slot-faculty d-block">${esc(slot.providerId?.name||"Faculty")}</span>
    <span class="slot-dept d-block">${esc(slot.providerId?.department||"Department not specified")}</span>
  </button>`).join("");
  container.querySelectorAll("[data-slot]").forEach(button=>button.onclick=()=>{
    selectedSlotId=button.dataset.slot;
    $("#slotSelect").value=selectedSlotId;
    $("#confirmBookingBtn").disabled=false;
    renderSlotCards();updateSelectionSummary();
  });
  if(!slots.some(s=>idOf(s)===selectedSlotId)){selectedSlotId="";$("#confirmBookingBtn").disabled=true;$("#slotSelect").value="";}
  updateSelectionSummary();
}
function updateSelectionSummary(){
  const slot=availableSlots.find(s=>idOf(s)===selectedSlotId);
  if(!slot){$("#selectedSlotTitle").textContent="No time selected yet";$("#selectedSlotDetails").textContent="Select an available slot to see the booking summary.";return;}
  $("#selectedSlotTitle").textContent=slot.providerId?.name||"Faculty appointment";
  $("#selectedSlotDetails").innerHTML=`<div class="mt-2"><strong>Date:</strong> ${esc(prettyDate(slot.date))}</div><div class="mt-1"><strong>Time:</strong> ${esc(slot.startTime)}–${esc(slot.endTime)}</div><div class="mt-1"><strong>Department:</strong> ${esc(slot.providerId?.department||"Not specified")}</div>`;
}
$("#bookingForm").onsubmit=async event=>{
  event.preventDefault();
  if(!isStudent()){toast("Only students can book appointments.");return;}
  if(!selectedSlotId){showMessage($("#bookingMessage"),"Please select an available slot first.");return;}
  const slot=availableSlots.find(s=>idOf(s)===selectedSlotId);
  if(!slot){showMessage($("#bookingMessage"),"This slot is no longer in the current list. Please select again.");await loadSlots();return;}
  if(slot.date<todayLocal()||(slot.date===todayLocal()&&slot.startTime<=new Date().toTimeString().slice(0,5))){showMessage($("#bookingMessage"),"This time has passed. Please choose a future slot.");await loadSlots();return;}
  $("#confirmBookingBtn").disabled=true;
  try{
    const result=await api("/appointments",{method:"POST",body:JSON.stringify({slotId:selectedSlotId,service:$("#service").value,message:$("#message").value})});
    showMessage($("#bookingMessage"),`${result.message} Booking ID: ${result.appointment.bookingId}. Status: ${result.appointment.status}.`,true);
    event.target.reset();selectedSlotId="";await loadSlots();await loadMine();await loadNotifications();await loadStats();
  }catch(error){showMessage($("#bookingMessage"),error.message);await loadSlots();}
  finally{$("#confirmBookingBtn").disabled=!selectedSlotId;}
};

/* Student appointments and notifications */
async function loadMine(){
  const list=await api("/appointments/mine");
  $("#myAppointments").innerHTML=!list.length?'<div class="empty">No appointments yet. Choose an available slot to get started.</div>':`<table class="table"><thead><tr><th>Booking</th><th>Faculty / Date</th><th>Purpose</th><th>Status</th><th>Pass</th></tr></thead><tbody>${list.map(a=>`<tr><td><strong>${esc(a.bookingId)}</strong><div class="small muted">${esc(a.startTime)}–${esc(a.endTime)}</div></td><td>${esc(a.providerId?.name||"Faculty")}<div class="small muted">${dateText(a.date)}</div></td><td>${esc(a.service)}</td><td>${statusTag(a.status)}</td><td><button type="button" class="btn btn-outline-primary btn-sm" data-pass-id="${esc(a._id)}">View pass</button></td></tr>`).join("")}</tbody></table>`;
  $("#myAppointments").querySelectorAll("[data-pass-id]").forEach(button => {
    button.addEventListener("click", () => {
      const appointment = list.find(item => idOf(item) === button.dataset.passId);
      if (appointment) openAppointmentPass(appointment);
    });
  });
}
let activePassAppointment = null;

function openAppointmentPass(appointment) {
  activePassAppointment = appointment;
  $("#passBookingId").textContent = appointment.bookingId || "—";
  $("#passStatus").innerHTML = statusTag(appointment.status || "Pending");
  $("#passStudent").textContent = currentUser?.name || "Student";
  $("#passFaculty").textContent = appointment.providerId?.name || "Faculty";
  $("#passDate").textContent = appointment.date || "—";
  $("#passTime").textContent = `${appointment.startTime || ""}–${appointment.endTime || ""}`;
  $("#passPurpose").textContent = appointment.service || "Appointment";
  $("#passMessage").textContent = "";
  const qrContainer = $("#appointmentQrCode");
  qrContainer.innerHTML = "";
  const qrPayload = `CAMPUSCONNECT:${appointment.verificationToken || ""}`;
  if (!appointment.verificationToken) {
    $("#passMessage").textContent = "This appointment does not have a secure verification token. Refresh the appointment list or contact the administrator.";
  }
  if (typeof QRCode === "undefined") {
    $("#passMessage").textContent = "QR library did not load. Check your internet connection and refresh the page.";
  } else {
    new QRCode(qrContainer, {
      text: qrPayload,
      width: 180,
      height: 180,
      colorDark: "#172b3a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
  }
  const modalElement = $("#appointmentPassModal");
  if (window.bootstrap?.Modal) {
    bootstrap.Modal.getOrCreateInstance(modalElement).show();
  } else {
    $("#passMessage").textContent = "The pass dialog could not open because Bootstrap's JavaScript did not load.";
  }
}

$("#downloadPassQr").onclick = () => {
  const canvas = $("#appointmentQrCode").querySelector("canvas");
  const image = $("#appointmentQrCode").querySelector("img");
  const source = canvas ? canvas.toDataURL("image/png") : image?.src;
  if (!source) {
    $("#passMessage").textContent = "QR code is not ready to download yet.";
    return;
  }
  const link = document.createElement("a");
  link.href = source;
  link.download = `${activePassAppointment?.bookingId || "CampusConnect"}-QR.png`;
  link.click();
};

$("#printAppointmentPass").onclick = () => {
  if (!activePassAppointment) return;
  const qrCanvas = $("#appointmentQrCode").querySelector("canvas");
  const qrImage = $("#appointmentQrCode").querySelector("img");
  const qrSrc = qrCanvas ? qrCanvas.toDataURL("image/png") : (qrImage?.src || "");
  const a = activePassAppointment;
  const printWindow = window.open("", "_blank", "width=720,height=850");
  if (!printWindow) {
    $("#passMessage").textContent = "Your browser blocked the print window. Allow pop-ups for this site and try again.";
    return;
  }
  const safe = value => esc(value);
  printWindow.document.write(`<!doctype html><html><head><title>Appointment ${safe(a.bookingId)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body{font-family:Arial,sans-serif;color:#172b3a;padding:32px;max-width:700px;margin:auto}
    .pass{border:1px solid #ccd5df;border-radius:18px;padding:28px}.brand{font-size:12px;letter-spacing:2px;color:#60758a}
    h1{margin:8px 0 20px}.id{font-size:24px;font-weight:bold}.qr{text-align:center;margin:20px}
    .qr img{width:180px;height:180px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;border:1px solid #ddd;padding:18px;border-radius:12px}
    .label{font-size:11px;color:#60758a;text-transform:uppercase;margin-bottom:5px}.value{font-weight:bold}
    @media print{body{padding:0}}</style></head><body><div class="pass">
    <div class="brand">CAMPUSCONNECT · DIGITAL APPOINTMENT PASS</div><h1>Faculty appointment</h1>
    <div class="label">Booking ID</div><div class="id">${safe(a.bookingId)}</div>
    <div class="qr">${qrSrc ? `<img src="${qrSrc}" alt="Appointment QR code">` : "QR code unavailable"}</div>
    <div class="grid">
      <div><div class="label">Student</div><div class="value">${safe(currentUser?.name || "Student")}</div></div>
      <div><div class="label">Faculty</div><div class="value">${safe(a.providerId?.name || "Faculty")}</div></div>
      <div><div class="label">Date</div><div class="value">${safe(a.date || "")}</div></div>
      <div><div class="label">Time</div><div class="value">${safe(`${a.startTime || ""}–${a.endTime || ""}`)}</div></div>
      <div><div class="label">Purpose</div><div class="value">${safe(a.service || "")}</div></div>
      <div><div class="label">Status</div><div class="value">${safe(a.status || "")}</div></div>
    </div><p style="font-size:12px;color:#60758a;margin-top:18px">Present this pass for reference. The QR code is a display pass, not a secure identity verification token.</p>
    </div><script>window.onload=()=>window.print();<\/script></body></html>`);
  printWindow.document.close();
};

async function loadNotifications(){
  const list=await api("/appointments/notifications");
  $("#notifications").innerHTML=!list.length?'<div class="empty">No notifications yet.</div>':list.map(n=>`<div class="notification-item">${esc(n.message)}<div class="small muted mt-1">${new Date(n.createdAt).toLocaleString()}</div></div>`).join("");
}
$("#refreshMine").onclick=async()=>{try{await loadSlots();await loadMine();await loadNotifications();await loadStats();}catch(error){toast(error.message);}};

/* QR verification and faculty check-in */
let activeQrScanner = null;
let activeScannedToken = "";
function normalizeQrToken(value) {
  return String(value || "").trim().replace(/^CAMPUSCONNECT:/i, "").trim();
}
function showVerifyResult(data, isError = false) {
  const target = $("#qrVerifyResult");
  if (isError) {
    target.innerHTML = `<div class="alert alert-danger mb-0">${esc(data)}</div>`;
    return;
  }
  const isApproved = ["Approved", "Rescheduled"].includes(data.status);
  const isToday = data.date === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let heading = "Booking found";
  let alertClass = "alert-info";
  let guidance = "This QR token matches a booking in CampusConnect.";
  if (data.alreadyCheckedIn) {
    heading = "Already checked in"; alertClass = "alert-warning";
    guidance = "This appointment has already been checked in. Duplicate check-in is not allowed.";
  } else if (!isApproved) {
    heading = "Awaiting faculty approval"; alertClass = "alert-warning";
    guidance = "This booking is not approved yet. Check-in is disabled until faculty approves it.";
  } else if (!isToday) {
    heading = "Appointment found — check-in not open"; alertClass = "alert-info";
    guidance = "Check-in is available only on the appointment date.";
  } else if (data.canCheckIn) {
    heading = "Approved appointment — ready for check-in"; alertClass = "alert-success";
    guidance = "Verify the student's details, then mark them arrived.";
  }
  target.innerHTML = `<div class="alert ${alertClass} mb-0">
    <div class="fw-bold">${heading}</div>
    <div class="small mt-1">${guidance}</div>
    <div class="mt-2"><strong>Booking:</strong> ${esc(data.bookingId)}</div>
    <div><strong>Student:</strong> ${esc(data.studentName)}</div>
    <div><strong>Faculty:</strong> ${esc(data.facultyName)}</div>
    <div><strong>Date/time:</strong> ${esc(data.date)} · ${esc(data.startTime)}–${esc(data.endTime)}</div>
    <div><strong>Purpose:</strong> ${esc(data.service)}</div>
    <div><strong>Status:</strong> ${esc(data.status)}</div>
    ${data.checkedInAt ? `<div><strong>Checked in:</strong> ${esc(new Date(data.checkedInAt).toLocaleString())}</div>` : ""}
    ${data.canCheckIn ? '<button type="button" class="btn btn-success mt-3" id="markCheckInBtn">Mark student arrived</button>' : ""}
  </div>`;
  if (data.canCheckIn) $("#markCheckInBtn").onclick = async () => {
    try {
      const result = await api("/appointments/check-in", { method: "POST", body: JSON.stringify({ token: activeScannedToken || normalizeQrToken($("#manualQrToken").value) }) });
      showVerifyResult(result);
      toast(result.message || "Student check-in recorded.");
      await loadAllAppointments(); await loadStats();
    } catch (error) { showVerifyResult(error.message, true); }
  };
}
async function verifyAppointmentToken(raw) {
  const token = normalizeQrToken(raw);
  if (!token) return showVerifyResult("QR token is empty.", true);
  activeScannedToken = token;
  $("#manualQrToken").value = token;
  try {
    const result = await api("/appointments/verify", { method: "POST", body: JSON.stringify({ token }) });
    showVerifyResult(result);
  } catch (error) { showVerifyResult(error.message, true); }
}
$("#manualVerifyForm").onsubmit = event => { event.preventDefault(); verifyAppointmentToken($("#manualQrToken").value); };
$("#startScannerBtn").onclick = async () => {
  if (!isAdmin() && !isFaculty()) return toast("Only faculty or administrators can scan appointment passes.");
  try {
    if (!window.Html5Qrcode) throw new Error("QR scanner library is unavailable. Check your internet connection.");
    $("#qr-reader").style.display = "block";
    if (activeQrScanner) { await activeQrScanner.stop().catch(() => {}); activeQrScanner.clear(); activeQrScanner = null; }
    activeQrScanner = new Html5Qrcode("qr-reader");
    await activeQrScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 230, height: 230 } }, async decoded => {
      await activeQrScanner.stop().catch(() => {}); activeQrScanner.clear(); activeQrScanner = null;
      $("#qr-reader").style.display = "none";
      await verifyAppointmentToken(decoded);
    }, () => {});
    $("#qrScannerHelp").textContent = "Camera is active. Hold the student's QR code inside the scan box.";
  } catch (error) {
    $("#qr-reader").style.display = "none";
    showVerifyResult("Could not start camera. Allow camera access and use localhost/HTTPS, or paste the QR token manually. " + error.message, true);
  }
};

/* Staff appointment table */
async function loadAllAppointments(){
  const all=await api("/appointments");
  cachedAppointments=all;
  const list=isFaculty()?all.filter(belongsToCurrentFaculty):all;
  $("#allAppointments").innerHTML=!list.length?'<div class="empty">No appointment requests found.</div>':`<table class="table"><thead><tr><th>Booking / Student</th><th>Faculty / Date</th><th>Purpose / Time</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map(a=>`<tr>
    <td><strong>${esc(a.bookingId)}</strong><div class="small muted">${esc(a.userId?.name||"Student")}</div><div class="small muted">${esc(a.userId?.email||"")}</div></td>
    <td>${esc(a.providerId?.name||"Faculty")}<div class="small muted">${esc(a.date)}</div></td>
    <td>${esc(a.service)}<div class="small muted">${esc(a.startTime)}–${esc(a.endTime)}</div></td><td>${statusTag(a.status)}</td>
    <td><div class="table-actions">
      ${a.status==="Pending"?`<button class="btn btn-success btn-sm" onclick="changeStatus('${a._id}','Approved')">Approve</button>`:""}
      ${!["Cancelled","Completed","Rejected"].includes(a.status)?`<button class="btn btn-outline-danger btn-sm" onclick="changeStatus('${a._id}','Cancelled')">Cancel</button><button class="btn btn-outline-primary btn-sm" onclick="reschedule('${a._id}')">Reschedule</button><button class="btn btn-light btn-sm" onclick="changeStatus('${a._id}','Completed')">Complete</button>`:""}
    </div></td></tr>`).join("")}</tbody></table>`;
  if(isAdmin()) renderAdminAnalytics(all);
}
window.changeStatus=async(id,status)=>{
  if(!confirm(`Change appointment status to ${status}?`))return;
  try{const result=await api(`/appointments/${id}/status`,{method:"PATCH",body:JSON.stringify({status})});toast(result.message);await loadAllAppointments();await loadStats();}
  catch(error){toast(error.message);}
};
window.reschedule=async id=>{
  try{
    const slots=await api("/availability"),choices=slots.filter(s=>s.isAvailable&&s.date>=todayLocal()&&(!isFaculty()||idOf(s.providerId)===idOf(currentUser)));
    if(!choices.length){toast("No available slots. Add availability first.");return;}
    const answer=prompt("Enter the number of the new slot:\n"+choices.map((s,i)=>`${i+1}. ${s.providerId?.name||"Faculty"} — ${s.date} ${s.startTime}-${s.endTime}`).join("\n"));
    if(!answer)return;const index=Number(answer)-1;
    if(!Number.isInteger(index)||index<0||index>=choices.length){toast("Invalid selection.");return;}
    const result=await api(`/appointments/${id}/reschedule`,{method:"PATCH",body:JSON.stringify({slotId:choices[index]._id})});
    toast(result.message);await loadAllAppointments();await loadStats();
  }catch(error){toast(error.message);}
};

/* Admin-only analytics. All data comes from the authenticated admin appointments endpoint. */
function destroyAnalyticsCharts(){
  Object.values(analyticsCharts).forEach(chart=>{try{chart.destroy();}catch(error){}});
  analyticsCharts={};
}
function renderAdminAnalytics(items){
  if(!isAdmin()) return;
  const countStatus=status=>items.filter(a=>a.status===status).length;
  const total=items.length, pending=countStatus("Pending");
  const approved=items.filter(a=>["Approved","Rescheduled"].includes(a.status)).length;
  const completed=countStatus("Completed"), cancelled=countStatus("Cancelled");
  const checkedIn=items.filter(a=>Boolean(a.checkedInAt)).length;
  const kpis=[
    ["Total bookings",total,"All recorded appointments"],
    ["Awaiting approval",pending,"Pending faculty action"],
    ["Approved / moved",approved,"Approved or rescheduled"],
    ["Completed",completed,"Marked completed"],
    ["Cancelled",cancelled,"Cancelled bookings"],
    ["Students checked in",checkedIn,"Recorded QR check-ins"]
  ];
  $("#analyticsKpis").innerHTML=kpis.map(([label,value,caption])=>`<div class="col-6 col-md-4 col-xl-2"><div class="stat-card h-100"><div class="stat-label">${esc(label)}</div><div class="stat-value">${value}</div><div class="small muted mt-1">${esc(caption)}</div></div></div>`).join("");
  const statusLabels=["Pending","Approved","Rescheduled","Completed","Cancelled"];
  const statusValues=statusLabels.map(countStatus);
  const deptCounts={}, facultyCounts={};
  for(const a of items){
    const dept=a.providerId?.department||"Unspecified";
    const faculty=a.providerId?.name||"Unknown faculty";
    deptCounts[dept]=(deptCounts[dept]||0)+1;
    facultyCounts[faculty]=(facultyCounts[faculty]||0)+1;
  }
  const recent=[...items].sort((a,b)=>`${b.date||""} ${b.startTime||""}`.localeCompare(`${a.date||""} ${a.startTime||""}`)).slice(0,8);
  $("#analyticsRecent").innerHTML=recent.length?`<table class="table table-sm align-middle"><thead><tr><th>Booking</th><th>Student</th><th>Faculty</th><th>Date / time</th><th>Purpose</th><th>Status</th><th>Check-in</th></tr></thead><tbody>${recent.map(a=>`<tr><td><strong>${esc(a.bookingId||"—")}</strong></td><td>${esc(a.userId?.name||"Student")}</td><td>${esc(a.providerId?.name||"Faculty")}</td><td>${esc(a.date||"—")}<div class="small muted">${esc(a.startTime||"")}–${esc(a.endTime||"")}</div></td><td>${esc(a.service||"—")}</td><td>${statusTag(a.status||"Unknown")}</td><td>${a.checkedInAt?'<span class="text-success">Yes</span>':'<span class="muted">No</span>'}</td></tr>`).join("")}</tbody></table>`:'<div class="empty">No appointments available for analytics yet.</div>';
  destroyAnalyticsCharts();
  if(typeof Chart==="undefined"){
    $("#analyticsRecent").insertAdjacentHTML("beforebegin",'<div class="alert alert-warning">Charts could not load. Check your internet connection; summary and recent bookings are still available.</div>');
    return;
  }
  const common={responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"}}};
  analyticsCharts.status=new Chart($("#statusChart"),{type:"doughnut",data:{labels:statusLabels,datasets:[{data:statusValues}]},options:{...common,cutout:"62%"}});
  const departments=Object.entries(deptCounts).sort((a,b)=>b[1]-a[1]);
  analyticsCharts.department=new Chart($("#departmentChart"),{type:"bar",data:{labels:departments.map(x=>x[0]),datasets:[{label:"Bookings",data:departments.map(x=>x[1])}]},options:{...common,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});
  const faculty=Object.entries(facultyCounts).sort((a,b)=>b[1]-a[1]);
  analyticsCharts.faculty=new Chart($("#facultyChart"),{type:"bar",data:{labels:faculty.map(x=>x[0]),datasets:[{label:"Appointments",data:faculty.map(x=>x[1])}]},options:{...common,indexAxis:"y",scales:{x:{beginAtZero:true,ticks:{precision:0}}},plugins:{legend:{display:false}}}});
}
$("#refreshAnalytics")?.addEventListener("click",async()=>{
  try{await loadAllAppointments();await loadStats();toast("Analytics refreshed.");}
  catch(error){toast(error.message);}
});

async function loadStats(){
  try{
    let list=await api(isStudent()?"/appointments/mine":"/appointments");
    if(isFaculty())list=list.filter(belongsToCurrentFaculty);
    const pending=list.filter(a=>a.status==="Pending").length;
    const approved=list.filter(a=>["Approved","Rescheduled"].includes(a.status)).length;
    $("#statsRow").innerHTML=[["Total appointments",list.length],["Awaiting action",pending],["Confirmed / moved",approved]].map(([label,value])=>`<div class="col-6 col-lg-4"><div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div></div>`).join("");
  }catch(error){$("#statsRow").innerHTML="";}
}
$("#refreshAll").onclick=async()=>{try{if(isAdmin())await loadFaculty();await loadAllAppointments();await loadStats();}catch(error){toast(error.message);}};
init().catch(error=>toast(error.message));

import { initializeApp } from
"https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile
} from
"https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
    getFirestore,
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    setDoc,
    query,
    where,
    onSnapshot,
    serverTimestamp
} from
"https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import {
    getMessaging,
    getToken,
    onMessage,
    isSupported
} from
"https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging.js";


// FIREBASE CONFIGURATION

const firebaseConfig = {
    apiKey: "AIzaSyBBnQPNAZrK0bGXuREtEk9nv1TT-u1Rvhs",
    authDomain: "mood-based-smart-tracker.firebaseapp.com",
    projectId: "mood-based-smart-tracker",
    storageBucket: "mood-based-smart-tracker.firebasestorage.app",
    messagingSenderId: "60267473249",
    appId: "1:60267473249:web:b0b2a3987293d80bf77d20",
    measurementId: "G-QJ6REQ7YGT"
};

const VAPID_KEY =
"BK0i5IR8lSgRnMByHc5IJdHkI7nI8Rp7m0b_HK4JDKwjd8Y-qcdDYoTaRBgPwiBMZZ1yvj81c9UKH8nT0pUbLCQ";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// GLOBAL VARIABLES

let currentUser = null;
let tasks = [];
let unsubscribeTasks = null;
let reminderInterval = null;
let calendarDate = new Date();
let selectedCalendarDate = new Date();
let messaging = null;
let foregroundListenerAdded = false;

const remindedTasks = new Set();

const $ = id => document.getElementById(id);


// HELPER FUNCTIONS

function showMessage(id, message, type = "success") {
    const element = $(id);
    if (!element) return;

    element.textContent = message;
    element.className = "message " + type;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return entities[character];
    });
}

function formatDate(value) {
    if (!value) return "No deadline";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "No deadline";

    return date.toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function getDateKey(date) {
    const d = new Date(date);

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


// FIREBASE MESSAGING

async function getMessagingInstance() {

    if (!await isSupported()) {
        throw new Error("Messaging is not supported by this browser.");
    }

    if (!messaging) {
        messaging = getMessaging(app);
    }

    return messaging;
}

async function enablePushNotifications() {

    if (!currentUser) {
        alert("Please log in first.");
        return;
    }

    if (!("Notification" in window)) {
        alert("Notifications are not supported in this browser.");
        return;
    }

    try {

        const permission = await Notification.requestPermission();

        if (permission !== "granted") {
            alert("Please allow notifications in browser settings.");
            return;
        }

        const registration = await navigator.serviceWorker.register(
            "./firebase-messaging-sw.js"
        );

        await navigator.serviceWorker.ready;

        const messagingInstance = await getMessagingInstance();

        const token = await getToken(messagingInstance, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration
        });

        if (!token) {
            alert("Unable to generate FCM token.");
            return;
        }

        await setDoc(
            doc(db, "users", currentUser.uid, "fcmTokens", token),
            {
                token: token,
                createdAt: serverTimestamp()
            }
        );

        if (!foregroundListenerAdded) {

            onMessage(messagingInstance, payload => {

                const title =
                    payload.notification?.title || "Moodly Reminder";

                const body =
                    payload.notification?.body || "You have a task reminder!";

                new Notification(title, { body });

            });

            foregroundListenerAdded = true;
        }

        startReminders();

        alert("Moodly push notifications enabled successfully! 🔔");

    } catch (error) {

        console.error("FCM setup error:", error);

        alert("Notification setup failed: " + error.message);

    }
}


// AUTHENTICATION TABS

$("loginTab").addEventListener("click", () => {

    $("loginForm").classList.remove("hidden");
    $("registerForm").classList.add("hidden");

    $("loginTab").classList.add("active");
    $("registerTab").classList.remove("active");

    showMessage("authMessage", "");

});

$("registerTab").addEventListener("click", () => {

    $("registerForm").classList.remove("hidden");
    $("loginForm").classList.add("hidden");

    $("registerTab").classList.add("active");
    $("loginTab").classList.remove("active");

    showMessage("authMessage", "");

});


// REGISTRATION

$("registerForm").addEventListener("submit", async event => {

    event.preventDefault();

    const name = $("registerName").value.trim();
    const email = $("registerEmail").value.trim();
    const password = $("registerPassword").value;

    try {

        showMessage("authMessage", "Creating your account...");

        const result = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

        await updateProfile(result.user, {
            displayName: name
        });

        $("registerForm").reset();

        showMessage("authMessage", "Account created successfully!");

    } catch (error) {

        showMessage("authMessage", error.message, "error");

    }

});


// LOGIN

$("loginForm").addEventListener("submit", async event => {

    event.preventDefault();

    try {

        showMessage("authMessage", "Logging in...");

        await signInWithEmailAndPassword(
            auth,
            $("loginEmail").value.trim(),
            $("loginPassword").value
        );

        $("loginForm").reset();

    } catch (error) {

        showMessage("authMessage", error.message, "error");

    }

});


// LOGOUT

$("logoutBtn").addEventListener("click", async () => {

    try {
        await signOut(auth);
    } catch (error) {
        showMessage("dashboardMessage", error.message, "error");
    }

});


// AUTH STATE

onAuthStateChanged(auth, user => {

    if (unsubscribeTasks) {
        unsubscribeTasks();
        unsubscribeTasks = null;
    }

    if (reminderInterval) {
        clearInterval(reminderInterval);
        reminderInterval = null;
    }

    currentUser = user;
    tasks = [];
    remindedTasks.clear();

    if (user) {

        $("authSection").classList.add("hidden");
        $("appLayout").classList.remove("hidden");
        $("logoutBtn").classList.remove("hidden");

        $("userName").textContent =
            user.displayName || user.email.split("@")[0];

        $("userNameHeading").textContent =
            user.displayName || "Friend";

        $("todayDate").textContent =
            new Date().toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric"
            });

        $("profileDisplayName").textContent =
            user.displayName || "Your profile";

        $("profileEmail").textContent = user.email;
        $("profileName").value = user.displayName || "";

        loadTasks();

        if ("Notification" in window &&
            Notification.permission === "granted") {
            startReminders();
        }

        showPage("dashboardPage");

    } else {

        $("authSection").classList.remove("hidden");
        $("appLayout").classList.add("hidden");
        $("logoutBtn").classList.add("hidden");

        $("taskList").innerHTML = "";

    }

});


// NAVIGATION

function showPage(pageId) {

    document.querySelectorAll(".page").forEach(page => {
        page.classList.add("hidden");
    });

    $(pageId).classList.remove("hidden");

    document.querySelectorAll(".nav-link").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageId
        );
    });

    if (pageId === "calendarPage") renderCalendar();

    if (pageId === "analyticsPage") updateAnalytics();

}

document.querySelectorAll(".nav-link").forEach(button => {

    button.addEventListener("click", () => {
        showPage(button.dataset.page);
    });

});


// FIRESTORE TASK LOADING

function loadTasks() {

    const tasksRef = collection(db, "tasks");

    const q = query(
        tasksRef,
        where("userId", "==", currentUser.uid)
    );

    unsubscribeTasks = onSnapshot(q, snapshot => {

        tasks = snapshot.docs.map(document => ({
            id: document.id,
            ...document.data()
        }));

        renderTasks();
        updateDashboard();
        updateProgress();
        updateWeeklyChart($("weeklyChart"));
        updateCalendarTaskMarkers();
        updateAnalytics();

    }, error => {

        showMessage(
            "dashboardMessage",
            "Unable to load tasks: " + error.message,
            "error"
        );

    });

}


// ADD TASK

$("taskForm").addEventListener("submit", async event => {

    event.preventDefault();

    if (!currentUser) return;

    const title = $("taskTitle").value.trim();
    const duration = Number($("taskDuration").value);
    const deadlineInput = $("taskDeadline").value;

    if (!title || !Number.isFinite(duration) ||
        duration < 1 || duration > 1440) {

        showMessage("taskMessage", "Enter valid task details.", "error");
        return;
    }

    const deadline = deadlineInput
        ? new Date(deadlineInput).toISOString()
        : null;

    try {

        await addDoc(collection(db, "tasks"), {

            userId: currentUser.uid,
            title,
            priority: $("taskPriority").value,
            difficulty: $("taskDifficulty").value,
            duration,
            deadline,
            completed: false,
            completedAt: null,
            createdAt: serverTimestamp()

        });

        $("taskForm").reset();

        $("taskPriority").value = "medium";
        $("taskDifficulty").value = "medium";
        $("taskDuration").value = 30;

        showMessage("taskMessage", "Task added successfully!");

    } catch (error) {

        showMessage("taskMessage", error.message, "error");

    }

});


// RENDER TASKS

function renderTasks() {

    const filter = $("taskFilter").value;

    let filteredTasks = [...tasks];

    if (filter === "pending") {
        filteredTasks = filteredTasks.filter(task => !task.completed);
    }

    if (filter === "completed") {
        filteredTasks = filteredTasks.filter(task => task.completed);
    }

    filteredTasks.sort((a, b) => {

        if (a.completed !== b.completed) {
            return Number(a.completed) - Number(b.completed);
        }

        return new Date(a.deadline || "9999-12-31") -
            new Date(b.deadline || "9999-12-31");

    });

    if (!filteredTasks.length) {

        $("taskList").innerHTML = `
            <div class="empty-state">
                No tasks found. Add a task to get started! 💜
            </div>
        `;

        return;
    }

    $("taskList").innerHTML = filteredTasks.map(task => {

        const priority = ["high", "medium", "low"].includes(task.priority)
            ? task.priority
            : "medium";

        return `

            <article class="task-card ${task.completed ? "completed" : ""}">

                <input
                    type="checkbox"
                    class="task-check"
                    data-id="${escapeHTML(task.id)}"
                    data-action="toggle"
                    ${task.completed ? "checked" : ""}
                >

                <div class="task-content">

                    <div class="task-title">
                        ${escapeHTML(task.title)}
                    </div>

                    <div class="task-meta">

                        <span class="priority ${priority}">
                            ${priority.toUpperCase()} PRIORITY
                        </span>

                        <span>${escapeHTML(task.difficulty || "medium")}</span>

                        <span>${Number(task.duration) || 0} min</span>

                        <span>${escapeHTML(formatDate(task.deadline))}</span>

                    </div>

                </div>

                <div class="task-actions">

                    <button class="icon-btn"
                        data-action="edit"
                        data-id="${escapeHTML(task.id)}">✏️</button>

                    <button class="icon-btn"
                        data-action="delete"
                        data-id="${escapeHTML(task.id)}">🗑️</button>

                </div>

            </article>

        `;

    }).join("");

}


// COMPLETE AND UNDO

$("taskList").addEventListener("change", async event => {

    const checkbox = event.target.closest(
        'input[data-action="toggle"]'
    );

    if (!checkbox) return;

    const taskId = checkbox.dataset.id;
    const completed = checkbox.checked;

    try {

        await updateDoc(doc(db, "tasks", taskId), {

            completed,
            completedAt: completed ? serverTimestamp() : null

        });

    } catch (error) {

        checkbox.checked = !completed;

        showMessage("dashboardMessage", error.message, "error");

    }

});


// EDIT AND DELETE

$("taskList").addEventListener("click", async event => {

    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const task = tasks.find(item => item.id === button.dataset.id);

    if (!task) return;

    if (button.dataset.action === "delete") {

        if (!confirm("Delete this task?")) return;

        try {

            await deleteDoc(doc(db, "tasks", task.id));

            showMessage("dashboardMessage", "Task deleted!");

        } catch (error) {

            showMessage("dashboardMessage", error.message, "error");

        }

        return;
    }

    if (button.dataset.action === "edit") {

        const title = prompt("Task name:", task.title);

        if (title === null) return;

        if (!title.trim()) {
            alert("Task name cannot be empty.");
            return;
        }

        const durationText = prompt(
            "Duration in minutes:",
            task.duration
        );

        if (durationText === null) return;

        const duration = Number(durationText);

        if (!Number.isFinite(duration) || duration < 1 || duration > 1440) {
            alert("Enter a valid duration.");
            return;
        }

        const priority = prompt(
            "Priority: high, medium or low",
            task.priority
        );

        if (priority === null) return;

        if (!["high", "medium", "low"].includes(priority.toLowerCase())) {
            alert("Invalid priority.");
            return;
        }

        const difficulty = prompt(
            "Difficulty: easy, medium or hard",
            task.difficulty
        );

        if (difficulty === null) return;

        if (!["easy", "medium", "hard"].includes(difficulty.toLowerCase())) {
            alert("Invalid difficulty.");
            return;
        }

        const oldDeadline = task.deadline
            ? new Date(task.deadline)
            : null;

        const localDeadline = oldDeadline
            ? new Date(oldDeadline.getTime() -
                oldDeadline.getTimezoneOffset() * 60000)
                .toISOString().slice(0, 16)
            : "";

        const deadlineText = prompt(
            "Deadline (YYYY-MM-DDTHH:MM), blank to remove:",
            localDeadline
        );

        if (deadlineText === null) return;

        let deadline = null;

        if (deadlineText.trim()) {

            const parsed = new Date(deadlineText);

            if (Number.isNaN(parsed.getTime())) {
                alert("Invalid deadline.");
                return;
            }

            deadline = parsed.toISOString();

        }

        try {

            await updateDoc(doc(db, "tasks", task.id), {

                title: title.trim(),
                duration,
                priority: priority.toLowerCase(),
                difficulty: difficulty.toLowerCase(),
                deadline

            });

            showMessage("dashboardMessage", "Task updated!");

        } catch (error) {

            showMessage("dashboardMessage", error.message, "error");

        }

    }

});

$("taskFilter").addEventListener("change", renderTasks);


// DASHBOARD

function updateDashboard() {

    const total = tasks.length;

    const completed = tasks.filter(task => task.completed).length;

    const pending = total - completed;

    const percentage = total
        ? Math.round(completed / total * 100)
        : 0;

    $("totalTasks").textContent = total;
    $("completedTasks").textContent = completed;
    $("pendingTasks").textContent = pending;
    $("completionRate").textContent = percentage + "%";

}

function updateProgress() {

    const total = tasks.length;

    const completed = tasks.filter(task => task.completed).length;

    const percentage = total
        ? Math.round(completed / total * 100)
        : 0;

    $("completionPercentage").textContent = percentage + "%";

    $("progressBar").style.width = percentage + "%";

    $("progressText").textContent =
        `${completed} of ${total} tasks completed`;

}


// WEEKLY CHART

function getWeeklyCounts() {

    const today = new Date();

    const days = [];

    for (let i = 6; i >= 0; i--) {

        const date = new Date(today);

        date.setHours(0, 0, 0, 0);
        date.setDate(today.getDate() - i);

        days.push({
            date,
            count: 0
        });

    }

    tasks.forEach(task => {

        if (!task.completed || !task.completedAt) return;

        const completedDate =
            typeof task.completedAt.toDate === "function"
                ? task.completedAt.toDate()
                : new Date(task.completedAt);

        if (Number.isNaN(completedDate.getTime())) return;

        completedDate.setHours(0, 0, 0, 0);

        const matchingDay = days.find(day =>
            day.date.getTime() === completedDate.getTime()
        );

        if (matchingDay) matchingDay.count++;

    });

    return days;
}

function updateWeeklyChart(element) {

    if (!element) return;

    const days = getWeeklyCounts();

    const maxCount = Math.max(
        1,
        ...days.map(day => day.count)
    );

    element.innerHTML = days.map(day => {

        const height = day.count
            ? Math.max(8, day.count / maxCount * 100)
            : 4;

        const label = day.date.toLocaleDateString("en-US", {
            weekday: "short"
        });

        return `

            <div class="chart-day">

                <span class="chart-count">${day.count}</span>

                <div class="chart-bar-area">
                    <div class="chart-bar" style="height:${height}%"></div>
                </div>

                <span class="chart-label">${label}</span>

            </div>

        `;

    }).join("");

}


// MOOD RECOMMENDATION

$("recommendationForm").addEventListener("submit", event => {

    event.preventDefault();

    const mood = $("userMood").value;
    const availableTime = Number($("availableTime").value);

    const pendingTasks = tasks.filter(task => !task.completed);

    if (!pendingTasks.length) {

        $("recommendationResult").innerHTML =
            "🌸 You have no pending tasks. Add your own tasks first!";

        return;
    }

    const suitableTasks = pendingTasks.filter(task =>
        Number(task.duration) <= availableTime
    );

    if (!suitableTasks.length) {

        $("recommendationResult").innerHTML =
            "⏳ No task fits your available time. Try selecting more time.";

        return;
    }

    const moodScores = {

        tired: { easy: 35, medium: 15, hard: 0 },
        sad: { easy: 35, medium: 15, hard: 0 },
        stressed: { easy: 30, medium: 20, hard: 0 },
        motivated: { easy: 5, medium: 25, hard: 35 },
        happy: { easy: 10, medium: 25, hard: 30 },
        calm: { easy: 20, medium: 35, hard: 15 }

    };

    function calculateScore(task) {

        let score = 0;

        score += moodScores[mood][task.difficulty] ?? 10;

        const priorityScores = {
            high: 35,
            medium: 20,
            low: 5
        };

        score += priorityScores[task.priority] ?? 10;

        if (task.deadline) {

            const hoursLeft =
                (new Date(task.deadline).getTime() - Date.now()) / 3600000;

            if (hoursLeft < 0) score += 50;
            else if (hoursLeft <= 3) score += 45;
            else if (hoursLeft <= 12) score += 40;
            else if (hoursLeft <= 24) score += 35;
            else if (hoursLeft <= 72) score += 25;
            else if (hoursLeft <= 168) score += 15;

        }

        const unusedTime =
            availableTime - Number(task.duration);

        score += Math.max(5, 25 - unusedTime / 15);

        return score;
    }

    suitableTasks.sort(
        (a, b) => calculateScore(b) - calculateScore(a)
    );

    const bestTask = suitableTasks[0];

    $("recommendationResult").innerHTML = `

        <span class="recommendation-icon">💜</span>

        <p>Your recommended task</p>

        <h3>${escapeHTML(bestTask.title)}</h3>

        <div>
            Priority: ${escapeHTML(bestTask.priority)}<br>
            Difficulty: ${escapeHTML(bestTask.difficulty)}<br>
            Estimated time: ${Number(bestTask.duration)} minutes
        </div>

        <p>✨ This task matches your current mood and available time.</p>

    `;

});


// CALENDAR

function renderCalendar() {

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    $("calendarMonth").textContent =
        calendarDate.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric"
        });

    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    let html = weekdays.map(day =>
        `<div class="calendar-weekday">${day}</div>`
    ).join("");

    for (let i = 0; i < firstDay; i++) {
        html += "<div></div>";
    }

    const todayKey = getDateKey(new Date());
    const selectedKey = getDateKey(selectedCalendarDate);

    for (let day = 1; day <= daysInMonth; day++) {

        const date = new Date(year, month, day);
        const key = getDateKey(date);

        const hasTask = tasks.some(task =>
            task.deadline &&
            getDateKey(new Date(task.deadline)) === key
        );

        const classes = [
            "calendar-day",
            key === todayKey ? "today" : "",
            key === selectedKey ? "selected" : "",
            hasTask ? "has-task" : ""
        ].filter(Boolean).join(" ");

        html += `
            <button class="${classes}" data-date="${key}">
                ${day}
            </button>
        `;

    }

    $("calendarGrid").innerHTML = html;

    renderCalendarTasks();

}

function renderCalendarTasks() {

    const key = getDateKey(selectedCalendarDate);

    const selectedTasks = tasks.filter(task =>
        task.deadline &&
        getDateKey(new Date(task.deadline)) === key
    );

    if (!selectedTasks.length) {

        $("calendarTasks").innerHTML =
            "<p>No tasks scheduled for this date.</p>";

        return;
    }

    $("calendarTasks").innerHTML = `

        <strong>Tasks for ${selectedCalendarDate.toLocaleDateString()}:</strong>

        ${selectedTasks.map(task => `

            <p>
                ${task.completed ? "✓" : "○"}
                ${escapeHTML(task.title)}
                — ${escapeHTML(formatDate(task.deadline))}
            </p>

        `).join("")}

    `;

}

$("calendarGrid").addEventListener("click", event => {

    const button = event.target.closest("[data-date]");

    if (!button) return;

    const [year, month, day] = button.dataset.date.split("-").map(Number);

    selectedCalendarDate = new Date(year, month - 1, day);

    renderCalendar();

});

$("prevMonth").addEventListener("click", () => {

    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();

});

$("nextMonth").addEventListener("click", () => {

    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendar();

});

function updateCalendarTaskMarkers() {

    if (!$("calendarPage").classList.contains("hidden")) {
        renderCalendar();
    }

}


// ANALYTICS

function updateAnalytics() {

    if (!$("analyticsPage")) return;

    const total = tasks.length;

    const completed = tasks.filter(task => task.completed).length;

    const pending = total - completed;

    const rate = total
        ? Math.round(completed / total * 100)
        : 0;

    $("analyticsTotal").textContent = total;
    $("analyticsCompleted").textContent = completed;
    $("analyticsPending").textContent = pending;
    $("analyticsRate").textContent = rate + "%";

    $("completedDistribution").style.width =
        (total ? completed / total * 100 : 0) + "%";

    $("pendingDistribution").style.width =
        (total ? pending / total * 100 : 0) + "%";

    updateWeeklyChart($("analyticsChart"));

}


// PROFILE

$("profileForm").addEventListener("submit", async event => {

    event.preventDefault();

    const name = $("profileName").value.trim();

    if (!name) {
        showMessage("profileMessage", "Enter your name.", "error");
        return;
    }

    try {

        await updateProfile(currentUser, {
            displayName: name
        });

        $("userName").textContent = name;
        $("userNameHeading").textContent = name;
        $("profileDisplayName").textContent = name;

        showMessage("profileMessage", "Profile updated successfully!");

    } catch (error) {

        showMessage("profileMessage", error.message, "error");

    }

});


// DARK MODE

function toggleTheme() {

    document.body.classList.toggle("dark");

    const dark = document.body.classList.contains("dark");

    $("themeBtn").textContent = dark ? "☀️" : "🌙";

    try {
        localStorage.setItem("moodlyTheme", dark ? "dark" : "light");
    } catch (error) {
        console.warn("Could not save theme.");
    }

}

try {

    if (localStorage.getItem("moodlyTheme") === "dark") {
        document.body.classList.add("dark");
        $("themeBtn").textContent = "☀️";
    }

} catch (error) {
    console.warn("Could not load theme.");
}

$("themeBtn").addEventListener("click", toggleTheme);
$("profileThemeBtn").addEventListener("click", toggleTheme);


// NOTIFICATION BUTTONS

$("notificationBtn").addEventListener("click", enablePushNotifications);

$("profileNotificationBtn").addEventListener("click", enablePushNotifications);


// LOCAL DEADLINE REMINDERS

function startReminders() {

    if (reminderInterval) {
        clearInterval(reminderInterval);
    }

    checkReminders();

    reminderInterval = setInterval(checkReminders, 30000);

}

function checkReminders() {

    if (!currentUser ||
        !("Notification" in window) ||
        Notification.permission !== "granted") {
        return;
    }

    const now = Date.now();

    tasks.forEach(task => {

        if (task.completed || !task.deadline) return;

        const deadline = new Date(task.deadline).getTime();

        if (Number.isNaN(deadline)) return;

        if (deadline <= now && !remindedTasks.has(task.id)) {

            new Notification("Moodly Task Reminder 🔔", {
                body: `Your task "${task.title}" has reached its deadline.`
            });

            remindedTasks.add(task.id);

        }

    });

}

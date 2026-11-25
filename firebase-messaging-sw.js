
importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js");

firebase.initializeApp({
    apiKey: "AIzaSyBBnQPNAZrK0bGXuREtEk9nv1TT-u1Rvhs",
    authDomain: "mood-based-smart-tracker.firebaseapp.com",
    projectId: "mood-based-smart-tracker",
    storageBucket: "mood-based-smart-tracker.firebasestorage.app",
    messagingSenderId: "60267473249",
    appId: "1:60267473249:web:b0b2a3987293d80bf77d20"
});

const messaging = firebase.messaging();

// Receive notifications when Moodly is in the background
messaging.onBackgroundMessage((payload) => {
    const title =
        payload.notification?.title || "Moodly Reminder 🔔";

    const options = {
        body:
            payload.notification?.body ||
            "You have a task reminder."
    };

    self.registration.showNotification(title, options);
});

// Open Moodly when the notification is clicked
self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({
            type: "window",
            includeUncontrolled: true
        }).then((windowClients) => {
            for (const client of windowClients) {
                if ("focus" in client) {
                    return client.focus();
                }
            }

            return clients.openWindow("./");
        })
    );
});

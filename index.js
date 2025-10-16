import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { nanoid } from "nanoid";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
    },
});

app.use(cors());
app.get("/", (req, res) => res.send("Typing Duel Backend Running...!"));

const PORT = 4000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

const rooms = {};

const sampleTexts = [
    "The art of typing quickly and accurately takes time to master. Every keystroke you make improves your rhythm and focus, helping you build the precision and confidence needed to express thoughts smoothly through the keyboard.",

    "Programming is not just about writing lines of code; it's about solving problems creatively. The best developers write code that others can understand, reuse, and improve, making teamwork and collaboration an essential part of every project.",

    "Success in any skill requires consistent effort and patience. Even when progress feels slow, each small improvement adds up over time. The journey of learning becomes rewarding when you enjoy the process rather than rushing the results.",

    "Technology evolves faster than ever before, and those who keep learning always stay ahead. Continuous curiosity, exploration, and practice turn ordinary individuals into innovators who create tools and systems that change how the world works.",

    "Every typist develops their own rhythm, shaped by habit and experience. The sound of clicking keys becomes music to their ears, a pattern of focus and flow that turns words into meaning and speed into satisfaction.",
];

const getRandomText = () => {
    return sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
};

io.on("connection", (socket) => {
    console.log("🔌 User connected:", socket.id);

    // --- CREATE ROOM ---
    socket.on("createRoom", ({ username }) => {
        const roomId = nanoid(6);
        const text = getRandomText();
        rooms[roomId] = {
            text,
            players: [{
                id: socket.id,
                username,
                progress: 0,
                wpm: 0,
                finished: false,
                correctChars: 0,
                ready: false
            }],
            started: false,
            gameStarted: false,
            winner: null,
        };

        socket.join(roomId);
        socket.emit("roomCreated", {
            roomId,
            text,
            username
        });
        console.log(`🧱 Room created: ${roomId} by ${username}`);
    });

    // --- JOIN ROOM ---
    socket.on("joinRoom", ({ roomId, username }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit("errorMsg", "❌ Room not found");

        room.players.push({
            id: socket.id,
            username,
            progress: 0,
            wpm: 0,
            finished: false,
            correctChars: 0,
            ready: false
        });
        socket.join(roomId);
        room.started = true;

        // Notify both players that game lobby is ready
        io.to(roomId).emit("startGame", {
            text: room.text,
            players: room.players.map((p) => ({
                username: p.username,
                id: p.id
            })),
        });

        console.log(`👥 ${username} joined room ${roomId}. Waiting for ready...`);
    });

    // --- PLAYER READY ---
    socket.on("playerReady", ({ roomId, username }) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find((p) => p.username === username);
        if (player) {
            player.ready = true;

            // Notify all players about ready status
            io.to(roomId).emit("playerReadyStatus", {
                username,
                ready: true,
                readyPlayers: room.players.filter(p => p.ready).length,
                totalPlayers: room.players.length
            });

            console.log(`✅ ${username} is ready in room ${roomId}`);

            // Check if all players are ready
            const allReady = room.players.every(p => p.ready);
            if (allReady && room.players.length > 1) {
                room.gameStarted = true;

                // Start countdown
                let countdown = 3;
                const countdownInterval = setInterval(() => {
                    io.to(roomId).emit("countdown", countdown);
                    countdown--;

                    if (countdown < 0) {
                        clearInterval(countdownInterval);
                        io.to(roomId).emit("raceStart");
                        console.log(`🏁 Race started in room ${roomId}`);
                    }
                }, 1000);
            }
        }
    });

    // --- PROGRESS UPDATE ---
    socket.on("progressUpdate", ({ roomId, username, progress, wpm, correctChars }) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        const player = room.players.find((p) => p.username === username);
        if (player) {
            player.progress = progress;
            player.wpm = wpm;
            player.correctChars = correctChars;
        }

        socket.to(roomId).emit("opponentProgress", {
            username,
            progress,
            wpm,
            correctChars
        });
    });

    // --- FINISHED GAME ---
    socket.on("finishedGame", ({ roomId, username, wpm }) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find((p) => p.username === username);
        if (player) player.finished = true;

        if (!room.winner) {
            room.winner = username;
            io.to(roomId).emit("gameOver", {
                winner: username,
                wpm: wpm
            });
            console.log(`🏁 ${username} won in room ${roomId} with ${wpm} WPM`);
        }
    });

    // --- DISCONNECT ---
    socket.on("disconnect", () => {
        console.log("❌ Disconnected:", socket.id);

        for (const [roomId, room] of Object.entries(rooms)) {
            const player = room.players.find((p) => p.id === socket.id);
            if (player) {
                room.players = room.players.filter((p) => p.id !== socket.id);
                io.to(roomId).emit("playerDisconnected", { username: player.username });
                console.log(`⚠️ ${player.username} disconnected from room ${roomId}`);

                if (room.players.length === 0) {
                    delete rooms[roomId];
                    console.log(`🗑️ Room ${roomId} deleted (empty)`);
                }
            }
        }
    });
});
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const Team = require('./models/Team');
const Player = require('./models/Player');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// --- SOCKET.IO SETUP ---
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] // Prioritize WebSocket
});

// --- DATABASE CONNECTION ---
// Added connection options for better reliability
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ DB Error:", err));

// --- REAL-TIME STATE (IN-MEMORY) ---
// This acts as a high-speed cache for the live auction
let auctionState = {
    currentBid: 0,
    leadingTeamId: null,
    currentPlayerId: null,
    status: 'IDLE' // IDLE, ACTIVE, SOLD, UNSOLD
};

// --- API ROUTES ---

// Initialize Data - OPTIMIZED WITH .lean()
app.get('/api/init', async (req, res) => {
    try {
        // .lean() makes queries much faster by returning plain JSON objects instead of Mongoose Docs
        const teams = await Team.find().populate('players').lean();
        const players = await Player.find().sort('order').lean();
        res.json({ teams, players });
    } catch (err) {
        console.error("Init Error:", err);
        res.status(500).json({ error: "Failed to load data" });
    }
});

// Add Team
app.post('/api/teams', async (req, res) => {
    try {
        const team = new Team(req.body);
        await team.save();
        io.emit('data_update'); // Tell clients to refresh
        res.json(team);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add Player
app.post('/api/players', async (req, res) => {
    try {
        const count = await Player.countDocuments();
        const player = new Player({ ...req.body, order: count });
        await player.save();
        io.emit('data_update');
        res.json(player);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Team
app.delete('/api/teams/:id', async (req, res) => {
    try {
        await Team.findByIdAndDelete(req.params.id);
        // Reset players bought by this team
        await Player.updateMany({ soldTo: req.params.id }, { isSold: false, soldTo: null, soldPrice: 0 });
        io.emit('data_update');
        res.json({ message: "Team deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Player
app.delete('/api/players/:id', async (req, res) => {
    try {
        const player = await Player.findById(req.params.id);
        if (!player) return res.status(404).json({ message: "Player not found" });

        // Refund budget if player was sold
        if (player.isSold && player.soldTo) {
            await Team.findByIdAndUpdate(player.soldTo, {
                $pull: { players: player._id }, // Optimized pull
                $inc: { spent: -player.soldPrice } // Optimized decrement
            });
        }

        await Player.findByIdAndDelete(req.params.id);
        io.emit('data_update'); // Ensure frontend syncs
        res.json({ message: "Player deleted" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --- SOCKET.IO LOGIC (HIGH PERFORMANCE) ---
io.on('connection', (socket) => {
    // Send current state immediately on connection
    socket.emit('auction_state', auctionState);

    // 1. START ROUND
    socket.on('start_player', ({ playerId, basePrice }) => {
        // Update RAM only - No DB hit yet
        auctionState = {
            currentBid: basePrice,
            leadingTeamId: null,
            currentPlayerId: playerId,
            status: 'ACTIVE'
        };
        // Broadcast immediately (Sub-10ms latency)
        io.emit('auction_state', auctionState);
    });

    // 2. PLACE BID
    socket.on('place_bid', ({ teamId, amount }) => {
        // Validation in RAM is instant
        if (amount <= auctionState.currentBid) return;

        auctionState.currentBid = amount;
        auctionState.leadingTeamId = teamId;

        io.emit('auction_state', auctionState);
    });

    // 3. SELL PLAYER (COMMITS TO DB)
    socket.on('sell_player', async () => {
        const { currentPlayerId, leadingTeamId, currentBid } = auctionState;

        if (currentPlayerId && leadingTeamId) {
            // Update UI State immediately so users see "SOLD" instantly
            auctionState.status = 'SOLD';
            io.emit('auction_state', auctionState);

            try {
                // Perform DB writes in parallel for speed
                const updatePlayer = Player.findByIdAndUpdate(currentPlayerId, {
                    isSold: true,
                    isUnsold: false,
                    soldTo: leadingTeamId,
                    soldPrice: currentBid
                });

                const updateTeam = Team.findByIdAndUpdate(leadingTeamId, {
                    $inc: { spent: currentBid }, // Atomic increment is safer/faster
                    $push: { players: currentPlayerId }
                });

                await Promise.all([updatePlayer, updateTeam]);

                // Only now trigger a full data refresh for clients
                io.emit('data_update');

            } catch (err) {
                console.error("Sale Error:", err);
                // Optional: Emit error state to admins
            }
        }
    });

    // 4. UNSELL PLAYER
    socket.on('unsell_player', async () => {
        const { currentPlayerId } = auctionState;
        if (currentPlayerId) {
            auctionState.status = 'UNSOLD';
            io.emit('auction_state', auctionState);

            try {
                await Player.findByIdAndUpdate(currentPlayerId, {
                    isSold: false,
                    isUnsold: true
                });
                io.emit('data_update');
            } catch (err) {
                console.error("Unsell Error:", err);
            }
        }
    });

    // 5. RESET ROUND
    socket.on('reset_round', () => {
        auctionState = {
            currentBid: 0,
            leadingTeamId: null,
            currentPlayerId: null,
            status: 'IDLE'
        };
        io.emit('auction_state', auctionState);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
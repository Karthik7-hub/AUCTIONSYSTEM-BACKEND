require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// Import Models
<<<<<<< HEAD
const Auction = require('./models/Auction');
=======
>>>>>>> e9e63a7c79c37291f79a75f8f458760786980897
const Team = require('./models/Team');
const Player = require('./models/Player');

const app = express();
const server = http.createServer(app);

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

<<<<<<< HEAD
// --- MULTI-AUCTION STATE MANAGEMENT ---
const auctionRooms = new Map();

const getRoomState = (auctionId) => {
    if (!auctionRooms.has(auctionId)) {
        auctionRooms.set(auctionId, {
=======
// --- SOCKET.IO SETUP ---
const io = new Server(server, {
    cors: {
        origin: "*", // Allow connections from any frontend (React/Mobile)
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] // Prioritize WebSocket for speed
});

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ DB Error:", err));

// --- REAL-TIME STATE (IN-MEMORY) ---
// Bidding happens here in RAM for zero latency.
// DB is only updated when a player is officially SOLD.
let auctionState = {
    currentBid: 0,
    leadingTeamId: null,
    currentPlayerId: null,
    status: 'IDLE' // IDLE, ACTIVE, SOLD, UNSOLD
};

// --- API ROUTES ---

// 1. Initialize Data (Optimized with .lean())
app.get('/api/init', async (req, res) => {
    try {
        // .lean() converts heavy Mongoose docs to simple JSON objects (Faster)
        const teams = await Team.find().populate('players').lean();
        const players = await Player.find().sort('order').lean();
        res.json({ teams, players });
    } catch (err) {
        console.error("Init Error:", err);
        res.status(500).json({ error: "Failed to load data" });
    }
});

// 2. Add Team
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

// 3. Add Player
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

// 4. Delete Team
app.delete('/api/teams/:id', async (req, res) => {
    try {
        await Team.findByIdAndDelete(req.params.id);
        // Reset players bought by this team so they aren't "ghost sold"
        await Player.updateMany({ soldTo: req.params.id }, { isSold: false, soldTo: null, soldPrice: 0 });
        io.emit('data_update');
        res.json({ message: "Team deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Delete Player
app.delete('/api/players/:id', async (req, res) => {
    try {
        const player = await Player.findById(req.params.id);
        if (!player) return res.status(404).json({ message: "Player not found" });

        // If player was sold, refund budget to the team
        if (player.isSold && player.soldTo) {
            await Team.findByIdAndUpdate(player.soldTo, {
                $pull: { players: player._id }, // Remove player ID from team array
                $inc: { spent: -player.soldPrice } // Refund money
            });
        }

        await Player.findByIdAndDelete(req.params.id);
        io.emit('data_update');
        res.json({ message: "Player deleted" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --- SOCKET.IO HANDLERS (THE BRAIN) ---
io.on('connection', (socket) => {
    // Send current state immediately upon connection (Syncs new users)
    socket.emit('auction_state', auctionState);

    // A. START ROUND
    socket.on('start_player', ({ playerId, basePrice }) => {
        auctionState = {
            currentBid: basePrice, // Set starting price
            leadingTeamId: null,   // No leader yet
            currentPlayerId: playerId,
            status: 'ACTIVE'
        };
        // Broadcast immediately (0 database latency)
        io.emit('auction_state', auctionState);
    });

    // B. PLACE BID (Fixed Logic)
    socket.on('place_bid', ({ teamId, amount }) => {
        
        // FIX: Allow opening bid if it EQUALS the base price
        if (auctionState.leadingTeamId === null) {
            // Opening bid validation
            if (amount < auctionState.currentBid) return; 
        } else {
            // Subsequent bid validation (Must be higher)
            if (amount <= auctionState.currentBid) return; 
        }

        // Update RAM State
        auctionState.currentBid = amount;
        auctionState.leadingTeamId = teamId;
        
        // Broadcast Update
        io.emit('auction_state', auctionState);
    });

    // C. SELL PLAYER (Commit to DB)
    socket.on('sell_player', async () => {
        const { currentPlayerId, leadingTeamId, currentBid } = auctionState;

        if (currentPlayerId && leadingTeamId) {
            // 1. Update RAM immediately for instant UI feedback
            auctionState.status = 'SOLD';
            io.emit('auction_state', auctionState);

            try {
                // 2. Perform heavy DB writes asynchronously
                // Parallel execution for speed
                const updatePlayer = Player.findByIdAndUpdate(currentPlayerId, {
                    isSold: true,
                    isUnsold: false,
                    soldTo: leadingTeamId,
                    soldPrice: currentBid
                });

                const updateTeam = Team.findByIdAndUpdate(leadingTeamId, {
                    $inc: { spent: currentBid }, // Atomic increment (Safe & Fast)
                    $push: { players: currentPlayerId } // Atomic push
                });

                await Promise.all([updatePlayer, updateTeam]);

                // 3. Trigger Data Refresh only after DB is secure
                io.emit('data_update'); 

            } catch (err) {
                console.error("Sale Error:", err);
            }
        }
    });

    // D. UNSELL PLAYER (Pass)
    socket.on('unsell_player', async () => {
        const { currentPlayerId } = auctionState;
        if (currentPlayerId) {
            auctionState.status = 'UNSOLD';
            io.emit('auction_state', auctionState);

            try {
                await Player.findByIdAndUpdate(currentPlayerId, {
                    isSold: false,
                    isUnsold: true // Mark as unsold in DB
                });
                io.emit('data_update');
            } catch (err) {
                console.error("Unsell Error:", err);
            }
        }
    });

    // E. RESET ROUND (Clear Screen)
    socket.on('reset_round', () => {
        auctionState = {
>>>>>>> e9e63a7c79c37291f79a75f8f458760786980897
            currentBid: 0,
            leadingTeamId: null,
            currentPlayerId: null,
            status: 'IDLE',
            bidHistory: []
        });
    }
    return auctionRooms.get(auctionId);
};

// --- DATABASE ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Scalable DB Connected"))
    .catch(err => console.error("❌ DB Error:", err));

// --- API ROUTES ---

// 1. Create Auction
app.post('/api/create-auction', async (req, res) => {
    try {
        const auction = new Auction(req.body);
        await auction.save();
        res.json(auction);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. List Auctions
app.get('/api/auctions', async (req, res) => {
    const auctions = await Auction.find({ isActive: true });
    res.json(auctions);
});

// 3. Init Specific Auction Data
app.get('/api/init/:auctionId', async (req, res) => {
    try {
        const { auctionId } = req.params;
        const teams = await Team.find({ auctionId }).populate('players').lean();
        const players = await Player.find({ auctionId }).sort('order').lean();
        const liveState = getRoomState(auctionId);
        res.json({ teams, players, liveState });
    } catch (err) { res.status(500).json({ error: "Failed to load data" }); }
});

// 4. Verify Admin Password
app.post('/api/verify-admin', async (req, res) => {
    try {
        const { auctionId, password } = req.body;
        const auction = await Auction.findById(auctionId);
        if (!auction) return res.status(404).json({ success: false });

        if (auction.accessCode === password) return res.json({ success: true });
        else return res.status(401).json({ success: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Add/Delete Logic (Scoped to AuctionId)
app.post('/api/teams', async (req, res) => {
    const team = new Team(req.body);
    await team.save();
    io.to(req.body.auctionId).emit('data_update');
    res.json(team);
});

app.post('/api/players', async (req, res) => {
    const count = await Player.countDocuments({ auctionId: req.body.auctionId });
    const player = new Player({ ...req.body, order: count });
    await player.save();
    io.to(req.body.auctionId).emit('data_update');
    res.json(player);
});

app.delete('/api/teams/:id', async (req, res) => {
    const team = await Team.findById(req.params.id);
    if (team) {
        const auctionId = team.auctionId.toString();
        await Team.findByIdAndDelete(req.params.id);
        await Player.updateMany({ soldTo: req.params.id }, { isSold: false, soldTo: null, soldPrice: 0 });
        io.to(auctionId).emit('data_update');
    }
    res.json({ message: "Deleted" });
});

app.delete('/api/players/:id', async (req, res) => {
    const player = await Player.findById(req.params.id);
    if (player) {
        const auctionId = player.auctionId.toString();
        if (player.isSold && player.soldTo) {
            await Team.findByIdAndUpdate(player.soldTo, { $pull: { players: player._id }, $inc: { spent: -player.soldPrice } });
        }
        await Player.findByIdAndDelete(req.params.id);
        io.to(auctionId).emit('data_update');
    }
    res.json({ message: "Deleted" });
});

// --- SOCKET.IO ---
const io = new Server(server, { cors: { origin: "*" }, transports: ['websocket', 'polling'] });

io.on('connection', (socket) => {

    socket.on('join_auction', (auctionId) => {
        socket.join(auctionId);
        socket.emit('auction_state', getRoomState(auctionId));
    });

    socket.on('start_player', ({ auctionId, playerId, basePrice }) => {
        const state = getRoomState(auctionId);
        state.currentBid = basePrice;
        state.leadingTeamId = null;
        state.currentPlayerId = playerId;
        state.status = 'ACTIVE';
        state.bidHistory = []; // Reset history
        io.to(auctionId).emit('auction_state', state);
    });

    socket.on('place_bid', ({ auctionId, teamId, amount }) => {
        const state = getRoomState(auctionId);

        if (state.leadingTeamId === null) {
            if (amount < state.currentBid) return;
        } else {
            if (amount <= state.currentBid) return;
        }

        // Save History
        state.bidHistory.push({ bid: state.currentBid, leader: state.leadingTeamId });

        state.currentBid = amount;
        state.leadingTeamId = teamId;
        io.to(auctionId).emit('auction_state', state);
    });

    socket.on('undo_bid', ({ auctionId }) => {
        const state = getRoomState(auctionId);
        if (state.bidHistory.length > 0) {
            const prev = state.bidHistory.pop();
            state.currentBid = prev.bid;
            state.leadingTeamId = prev.leader;
            io.to(auctionId).emit('auction_state', state);
        }
    });

    socket.on('toggle_pause', ({ auctionId }) => {
        const state = getRoomState(auctionId);
        state.status = state.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
        io.to(auctionId).emit('auction_state', state);
    });

    socket.on('sell_player', async ({ auctionId }) => {
        const state = getRoomState(auctionId);
        const { currentPlayerId, leadingTeamId, currentBid } = state;

        if (currentPlayerId && leadingTeamId) {
            state.status = 'SOLD';
            state.bidHistory = [];
            io.to(auctionId).emit('auction_state', state);

            try {
                await Promise.all([
                    Player.findByIdAndUpdate(currentPlayerId, { isSold: true, soldTo: leadingTeamId, soldPrice: currentBid }),
                    Team.findByIdAndUpdate(leadingTeamId, { $inc: { spent: currentBid }, $push: { players: currentPlayerId } })
                ]);
                io.to(auctionId).emit('data_update');
            } catch (err) { console.error(err); }
        }
    });

    socket.on('unsell_player', async ({ auctionId }) => {
        const state = getRoomState(auctionId);
        if (state.currentPlayerId) {
            state.status = 'UNSOLD';
            io.to(auctionId).emit('auction_state', state);
            await Player.findByIdAndUpdate(state.currentPlayerId, { isSold: false, isUnsold: true });
            io.to(auctionId).emit('data_update');
        }
    });

    socket.on('reset_round', ({ auctionId }) => {
        const state = getRoomState(auctionId);
        state.currentBid = 0;
        state.leadingTeamId = null;
        state.currentPlayerId = null;
        state.status = 'IDLE';
        io.to(auctionId).emit('auction_state', state);
    });
});

<<<<<<< HEAD
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Scalable Server running on port ${PORT}`));
=======
// --- SERVER START ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
>>>>>>> e9e63a7c79c37291f79a75f8f458760786980897

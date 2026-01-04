const mongoose = require('mongoose');

const AuctionSchema = new mongoose.Schema({
    name: { type: String, required: true }, // e.g., "SPL Season 2"
    date: { type: Date, default: Date.now },
    accessCode: { type: String, required: true }, // Host password
    isActive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Auction', AuctionSchema);
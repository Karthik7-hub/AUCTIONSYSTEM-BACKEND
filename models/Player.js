const mongoose = require('mongoose');

const PlayerSchema = new mongoose.Schema({
    auctionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Auction', required: true },
    name: String,
    role: String,
    category: String,
    basePrice: Number,
    order: Number,
    isSold: { type: Boolean, default: false },
    isUnsold: { type: Boolean, default: false },
    soldTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    soldPrice: { type: Number, default: 0 }
});

module.exports = mongoose.model('Player', PlayerSchema);
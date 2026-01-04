require('dotenv').config();
const mongoose = require('mongoose');

// Define temporary schemas just for migration
const AuctionSchema = new mongoose.Schema({ name: String, accessCode: String, isActive: Boolean });
const TeamSchema = new mongoose.Schema({}, { strict: false });
const PlayerSchema = new mongoose.Schema({}, { strict: false });

const Auction = mongoose.model('Auction', AuctionSchema);
const Team = mongoose.model('Team', TeamSchema);
const Player = mongoose.model('Player', PlayerSchema);

const migrate = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Connected to DB");

        // 1. Create the "Season 1" Container
        const oldAuction = new Auction({
            name: "SPL Season 1 (Legacy)",
            accessCode: "admin123",
            isActive: true
        });
        const savedAuction = await oldAuction.save();
        console.log(`✅ Created Legacy Auction: ${savedAuction._id}`);

        // 2. Move all existing Teams into this container
        const teamResult = await Team.updateMany(
            { auctionId: { $exists: false } }, // Find teams without an ID
            { $set: { auctionId: savedAuction._id } }
        );
        console.log(`✅ Migrated ${teamResult.modifiedCount} Teams.`);

        // 3. Move all existing Players into this container
        const playerResult = await Player.updateMany(
            { auctionId: { $exists: false } }, // Find players without an ID
            { $set: { auctionId: savedAuction._id } }
        );
        console.log(`✅ Migrated ${playerResult.modifiedCount} Players.`);

        console.log("🎉 MIGRATION COMPLETE!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Migration Failed:", err);
        process.exit(1);
    }
};

migrate();
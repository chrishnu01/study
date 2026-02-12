/**
 * Migration: Clear timeline for ALL leads in LeadOrder collection
 * Run using: node migrations/clearAllLeadTimelines.js
 */

const mongoose = require("mongoose");
const LeadOrder = require("./models/Case"); // adjust the path if needed
require("dotenv").config();

(async () => {
    try {
        // 1️⃣ Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log("✅ Connected to MongoDB");

        // 2️⃣ Confirm total count before update
        const totalLeads = await LeadOrder.countDocuments({});
        console.log(`📊 Found ${totalLeads} leads in database`);

        if (totalLeads === 0) {
            console.log("⚠️ No leads found — skipping timeline clear");
            process.exit(0);
        }

        // 3️⃣ Clear timeline for all leads
        const result = await LeadOrder.updateMany({}, { $set: { timeline: [] } });

        console.log(
            `✅ Successfully cleared timelines for ${result.modifiedCount || 0} leads`
        );

    } catch (err) {
        console.error("❌ Migration failed:", err);
    } finally {
        await mongoose.disconnect();
        console.log("🔌 MongoDB disconnected");
    }
})();


// /**
//  * Migration: Clear timeline for a specific lead in LeadOrder collection
//  * Run using: node migrations/clearTimelineForLead.js
//  */

// const mongoose = require("mongoose");
// const LeadOrder = require("./models/Case"); // adjust path as needed
// require("dotenv").config();

// (async () => {
//     try {
//         // 1️⃣ Connect to MongoDB
//         await mongoose.connect(process.env.MONGO_URI, {
//             useNewUrlParser: true,
//             useUnifiedTopology: true,
//         });
//         console.log("✅ Connected to MongoDB");

//         // 2️⃣ The lead ID whose timeline you want to clear
//         const leadId = "696f26efc0cd4f1e0941bd94"; // e.g. "67a79f4e6fdc1f28aa54a123"

//         if (!leadId) {
//             console.error("❌ Please provide a valid leadId in the script");
//             process.exit(1);
//         }

//         // 3️⃣ Update operation — clear timeline array
//         const result = await LeadOrder.updateOne(
//             { _id: leadId },
//             { $set: { timeline: [] } }
//         );

//         if (result.modifiedCount > 0) {
//             console.log(`✅ Successfully cleared timeline for lead ID: ${leadId}`);
//         } else {
//             console.log(`⚠️ No lead found with ID: ${leadId}, or timeline already empty.`);
//         }

//     } catch (err) {
//         console.error("❌ Migration failed:", err);
//     } finally {
//         await mongoose.disconnect();
//         console.log("🔌 MongoDB disconnected");
//     }
// })();

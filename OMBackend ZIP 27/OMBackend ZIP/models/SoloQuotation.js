const mongoose = require("mongoose");

const soloQuotationSchema = new mongoose.Schema(
    {
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        
        name: { type: String, required: true },
        siteAddress: { type: String, default: "" },
        sentDate: Date,
        daysRsInAdvance: { type: String }, // e.g. 60 days
        gstPercentage: { type: Number, default: 18 },
        // Each item has its own totals and GST
        items: [
            {
                item: { type: String }, // e.g. ISMB
                size: { type: String }, // e.g. 12-15 FT
                quantity: { type: Number }, // e.g. 60
                unit: { type: String }, // e.g. Per Pc Per Day
                rentRatePerPiecePerDay: { type: Number }, // e.g. 4.50
                rsInAdvance: { type: Number }, // e.g. 16200.00
                uM: { type: String }, // e.g. Pc's

                // Auto-calculated fields for each item
                totalBeforeGST: { type: Number }, // Rent subtotal before tax
                gstPercentage: { type: Number, default: 18 },
                gstAmount: { type: Number },
                totalAfterGST: { type: Number },
            }
        ],

        // Optional grand totals (can be summed from items)
        grandTotalBeforeGST: { type: Number },
        grandGSTAmount: { type: Number },
        grandTotalAfterGST: { type: Number },

        quotationFiles: [{ type: String }], // S3 links

        termsAndConditions: [
            {
                type: String, // e.g. "Goods once sold will not be taken back"
                trim: true,
            }
        ],

        followUps: [
            {
                user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                note: String,
                followUpDate: Date,
                createdAt: { type: Date, default: Date.now },
            },
        ],

        timeline: {
            type: [
                {
                    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                    changes: [
                        {
                            field: String,
                            oldValue: String,
                            newValue: String,
                        },
                    ],
                    updatedAt: { type: Date, default: Date.now },
                },
            ],
            default: [],
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Quotation", soloQuotationSchema);

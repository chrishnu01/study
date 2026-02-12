const mongoose = require("mongoose");

const quotationItemSchema = new mongoose.Schema(
    {
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        items: {
            name: String,
            size: [String],
        },

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

module.exports = mongoose.model("quotationItemSchema", quotationItemSchema);

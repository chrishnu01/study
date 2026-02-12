const mongoose = require("mongoose");

const visitDataSchema = new mongoose.Schema(
    {
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // If the login or remarks from the existing lead or customer
        companyName: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "LeadOrder",
        },

        // If the login or remarks are not from the existing lead or customer
        visitCompanyName: {
            name: { type: String },
            enquiry: { type: String },
            siteAddress: { type: String },
            contactPersonInfo: [
                {
                    contactPersonName: { type: String, trim: true },
                    contactPersonEmail: { type: String, trim: true },
                    contactPersonPhone: {
                        type: [Number]
                    },
                },
            ],
        },

        loginLocation: {
            address: { type: String },
            lat: { type: String },
            lng: { type: String }
        },

        logoutLocation: {
            address: { type: String },
            lat: { type: String },
            lng: { type: String }
        },

        loginAt: { type: Date },

        logoutAt: { type: Date, default: null },

        login: { type: Boolean },

        remarks: [
            {
                note: String,
                media: [{ type: String }],
                followUpDate: Date,
                createdAt: { type: Date, default: Date.now },
            }
        ],

    },
    { timestamps: true }
);

module.exports = mongoose.model("VisitData", visitDataSchema);

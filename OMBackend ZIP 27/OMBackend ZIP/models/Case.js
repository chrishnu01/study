const mongoose = require("mongoose");

const OrderDataSchema = new mongoose.Schema(
    {
        orderId: { type: String },
        createdDate: { type: Date },
        documents: [{ type: String, default: [] }], // S3 links
    },
    { _id: true } // keep _id for unique array tracking
);

const DispatchDataSchema = new mongoose.Schema({
    mrnNumber: String,
    dispatchDate: Date,
    documents: [{ type: String, default: [] }],
});

const ReturnDataSchema = new mongoose.Schema({
    returnNumber: String,
    returnDate: Date,
    documents: [{ type: String, default: [] }],
});

const leadOrderSchema = new mongoose.Schema(
    {
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        status: {
            type: String,
            enum: [
                "Lead Generated",
                "Lead Contacted",
                "Quotation Sent",
                "Quotation Approved",
                "Quotation Rejected",
                "Order Created",
                "Order Packed",
                "Order Shipped",
                "Agreement",
                "Security",
                "Dispatch",
                "Return",
                "Bill Raised",
                "Payment Pending",
                "Payment Partially Received",
                "Payment Completed",
                "Marked Defaulter",
                "Marked Discard",
                "Marked Complete",
                "Marked Legal",
                "Closed",
            ],
            default: "Lead Generated",
        },

        // 1. Lead Details
        lead: {
            name: { type: String, required: true },
            // contactPersonName: { type: String },
            // contactPersonEmail: { type: String, default: "" },
            // contactPersonPhone: {
            //     type: [Number],
            //     default: [],
            // },

            contactPersonInfo: [
                {
                    contactPersonName: { type: String, trim: true, default: "" },
                    contactPersonEmail: { type: String, trim: true, default: "" },
                    contactPersonPhone: {
                        type: [Number],
                        default: [], // allow multiple numbers for one contact
                    },
                },
            ],
            enquiry: { type: String, default: "" },
            siteAddress: { type: String, default: "" },
            customerAddress: { type: String, default: "" },

            source: [
                {
                    sourceName: { type: String, trim: true },
                    reference: { type: String, trim: true },
                }
            ],

            firmCompanyGST: { type: String, default: "" },
            firmCompanyGstFile: { type: String, default: "" }, // Single S3 file link
            aadharNumber: { type: String, default: "" },
            aadharFile: { type: String, default: "" }, // Single S3 file link
            panNumber: { type: String, default: "" },
            panFile: { type: String, default: "" }, // Single S3 file link
            authLetter: { type: String, default: "" },
            authLetterFile: { type: String, default: "" }, // Single S3 file link

            contactPersonAadharNumber: { type: String, default: "" },
            contactPersonAadharFile: { type: String, default: "" }, // Single S3 file link
            contactPersonPanNumber: { type: String, default: "" },
            contactPersonPanFile: { type: String, default: "" }, // Single S3 file link
        },

        // 2. Follow Ups
        leadFollowUps: [
            {
                user: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User"
                },
                note: String,
                nextFollowUpDate: Date,
                documents: [String], // S3 links
                // status: {
                //     type: String,
                //     enum: ["Progress", "Pending", "Completed"],
                //     default: "Progress",
                // },
                createdAt: { type: Date, default: Date.now },
            },
        ],

        // 3. Quotation
        quotation: [
            {
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

                        // For type Sale
                        amount: { type: Number },
                        uom: { type: String },
                        weight: { type: String },
                        rate: { type: String },
                    }
                ],
                
                type: {
                    type: String,
                    enum: ["Rent", "Sale"],
                    default: "Rent",
                },
                
                // Optional grand totals (can be summed from items)
                grandTotalBeforeGST: { type: Number },
                grandGSTAmount: { type: Number },
                grandTotalAfterGST: { type: Number },
                
                // For type Sale
                loadingCharges: { type: Number },
                freitCharges: {type: Number},

                quotationFiles: [
                    {
                        fileUrl: { type: String },
                        fileNumber: { type: Number },
                    },
                ],

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
                        // status: {
                        //     type: String,
                        //     enum: ["Progress", "Pending", "Completed"],
                        //     default: "Progress",
                        // },
                        createdAt: { type: Date, default: Date.now },
                    },
                ],
                updatedAt: { type: Date, default: Date.now },
            }
        ],

        // 4. Order
        order: {
            // orderId: String,
            // createdDate: Date,
            // documents: [String], // S3 links
            orderData: [OrderDataSchema],
        },

        // 5. Agreement Document
        aggrementDocument: {
            documents: {
                type: [String], // store multiple S3 links
                default: [],    // default empty array
            },
        },

        // 6. Security Document
        securityDocument: {
            documents: {
                type: [String], // store multiple S3 links
                default: [],    // default empty array
            },
        },

        // 7. Dispatch / MRN
        dispatch: {
            // mrnNumber: String,
            // dispatchDate: Date,
            // documents: [String], // S3 links
            dispatchData: [DispatchDataSchema],
        },

        // 8. Dispatch / MRN
        return: {
            // returnNumber: String,
            // returnDate: Date,
            // documents: [String], // S3 links
            returnData: [ReturnDataSchema],
        },

        // 9. Billing
        billing: {
            // billNumber: String,
            // amount: Number,
            // taxPercentage: { type: Number, default: 18 },
            // totalAmount: Number,
            // dueDate: Date,
            // billDate: Date,
            // billFiles: [String], // S3 links
            followUps: [
                {
                    user: {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: "User"
                    },
                    note: String,
                    followUpDate: Date,
                    // status: {
                    //     type: String,
                    //     enum: ["Progress", "Pending", "Completed"],
                    //     default: "Progress",
                    // },
                    createdAt: { type: Date, default: Date.now },
                },
            ],
            billingData: [
                {
                    billNumber: String,
                    amount: Number,
                    billFiles: [String], // S3 links
                    // followUps: [
                    //     {
                    //         user: {
                    //             type: mongoose.Schema.Types.ObjectId,
                    //             ref: "User"
                    //         },
                    //         note: String,
                    //         followUpDate: Date,
                    //         status: {
                    //             type: String,
                    //             enum: ["Progress", "Pending", "Completed"],
                    //             default: "Progress",
                    //         },
                    //         createdAt: { type: Date, default: Date.now },
                    //     },
                    // ]
                }
            ]
        },

        // 10. Payment Tracking
        payment: {
            // status: {
            //     type: String,
            //     enum: ["Pending", "Partially Paid", "Paid", "Overdue"],
            //     default: "Pending",
            // },
            // amountPaid: { type: Number, default: 0 },
            // dueDate: Date,
            followUps: [
                {
                    user: {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: "User"
                    },
                    note: String,
                    followUpDate: Date,
                    calledTo: [
                        {
                            name: String,
                            phone: Number,
                            talk: String
                        },
                        { _id: true }
                    ],
                    // status: {
                    //     type: String,
                    //     enum: ["Progress", "Pending", "Completed"],
                    //     default: "Progress",
                    // },
                    createdAt: { type: Date, default: Date.now },
                },
            ],
            paymentData: [
                {
                    status: {
                        type: String,
                        enum: ["Pending", "Partially Paid", "Paid", "Overdue"],
                        default: "Pending",
                    },
                    amountPaid: { type: Number, default: 0 },
                    dueDate: Date,
                    // followUps: [
                    //     {
                    //         user: {
                    //             type: mongoose.Schema.Types.ObjectId,
                    //             ref: "User"
                    //         },
                    //         note: String,
                    //         followUpDate: Date,
                    //         calledTo: [
                    //             {
                    //                 name: String,
                    //                 phone: Number,
                    //                 talk: String
                    //             },
                    //             { _id: true }
                    //         ],
                    //         status: {
                    //             type: String,
                    //             enum: ["Progress", "Pending", "Completed"],
                    //             default: "Progress",
                    //         },
                    //         createdAt: { type: Date, default: Date.now },
                    //     },
                    // ]
                }
            ]
        },

        // 11. Legal
        legal: {
            case: String,
            advocate: String,
            nextDate: Date,
            remarks: String,
            followUps: [
                {
                    user: {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: "User"
                    },
                    note: String,
                    followUpDate: Date,
                    // status: {
                    //     type: String,
                    //     enum: ["Progress", "Pending", "Completed"],
                    //     default: "Progress",
                    // },
                    createdAt: { type: Date, default: Date.now },
                },
            ],
        },

        isCustomer: {
            type: Boolean,
            default: false
        },

        leadAllotedTo: [
            {
                user: { type: String },
                messages: [
                    {
                        message: { type: String },
                        response: { type: String },
                        createdAt: { type: Date, default: Date.now },
                    },
                ],
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

module.exports = mongoose.model("LeadOrder", leadOrderSchema);

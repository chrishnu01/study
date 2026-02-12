const User = require('../models/User');
const leadOrder = require('../models/Case')
const VisitData = require("../models/VisitsData");
const jwt = require('jsonwebtoken');
const bcrypt = require("bcrypt")
const uploadToS3 = require('../utils/s3')
const deleteS3File = require("../utils/s3Delete")
const mongoose = require("mongoose");

const managerAppController = {

    // ****************************************************************USER API's**************************************************************************
    // User Login
    async userLogin(req, res) {
        try {
            const resp = await User.findOne({ email: req.body.email });
            if (!resp) {
                return res.status(200).json({
                    success: false,
                    message: "Email not found",
                });
            }

            // 🔒 Check if App Login is allowed
            if (!resp.isAppLogin) {
                return res.status(200).json({
                    success: false,
                    message: "App login is not allowed for this user. Please contact to administrator.",
                });
            }

            bcrypt.compare(req.body.password, resp.password, function (err, result) {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: "Error during password comparison",
                    });
                }
                console.log("result: ", result);


                if (result) {
                    const token = jwt.sign(
                        {
                            id: resp._id,
                            role: resp.role,
                            isDeletable: resp.isDeletable,
                            isEditable: resp.isEditable,
                        },
                        process.env.JWT_SECRET,
                        { expiresIn: "24h" }
                    );
                    return res.status(200).json({
                        success: true,
                        message: "Login Successfully",
                        token,
                        user: {
                            id: resp._id,
                            name: resp.name,
                            phone: resp.phone,
                            email: resp.email,
                            role: resp.role,
                        }
                    });
                } else {
                    return res.status(200).json({
                        success: false,
                        message: "Invalid Password",
                    });
                }
            });
        } catch (err) {
            console.log("Server Error Login User: ", err);
            return res.status(500).json({
                success: false,
                message: "Something went wrong, please try again",
            });
        }
    },

    // Get User
    async getUser(req, res) {
        try {
            const userId = req.user._id; // from auth middleware

            // Exclude password field directly in query
            const user = await User.findById(userId).select('-password');
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            res.status(200).json({
                success: true,
                user
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // Update User Password
    async updatePassword(req, res) {
        try {
            const userId = req.user._id; // From decoded token via authAdmin middleware
            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword) {
                return res.status(400).json({
                    success: false,
                    message: "Current and new password are required",
                });
            }

            const admin = await User.findById(userId);
            if (!admin) {
                return res.status(404).json({
                    success: false,
                    message: "User not found",
                });
            }

            // Compare current password with hashed password in DB
            const isMatch = await bcrypt.compare(currentPassword, admin.password);
            if (!isMatch) {
                return res.status(400).json({
                    success: false,
                    message: "Current password is incorrect",
                });
            }

            // Check if new password is the same as the current password
            const isSamePassword = await bcrypt.compare(newPassword, admin.password);
            if (isSamePassword) {
                return res.status(400).json({
                    success: false,
                    message: "New password must be different from the current password",
                });
            }

            // Set new password (will be hashed via Mongoose pre-save hook)
            admin.password = newPassword;
            await admin.save();

            res.status(200).json({
                success: true,
                message: "Password updated successfully",
            });

        } catch (error) {
            console.error("🔥 Error updating password:", error);
            res.status(500).json({
                success: false,
                message: "Internal Server Error",
                error: error.message,
            });
        }
    },

    // Update User
    async updateUser(req, res) {
        try {
            const userId = req.user._id; // Already extracted from token in authAdmin middleware

            // Only allow updating specific fields
            const { name, phone } = req.body;

            if (!name && !phone) {
                return res.status(400).json({
                    success: false,
                    message: "Nothing to update",
                });
            }

            // Check if the phone number already exists for another admin
            if (phone) {
                const existingPhone = await User.findOne({ phone, _id: { $ne: userId } });
                if (existingPhone) {
                    return res.status(400).json({
                        success: false,
                        message: "Phone number already exists for another admin",
                    });
                }
            }

            const updateData = {
                ...(name && { name }),
                ...(phone && { phone }),
                updated_at: new Date(),
            };

            const updatedAdmin = await User.findByIdAndUpdate(userId, updateData, { new: true });

            if (!updatedAdmin) {
                return res.status(404).json({
                    success: false,
                    message: "User not found",
                });
            }

            res.status(200).json({
                success: true,
                message: "Profile updated successfully",
            });
        } catch (error) {
            console.error("🔥 Error updating admin:", error);
            res.status(500).json({
                success: false,
                message: "Internal Server Error",
                error: error.message,
            });
        }
    },

    // Delete Account
    async deleteAccount(req, res) {
        try {
            const userId = req.user._id
            if (!userId) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            // 1️⃣ Find and update the user
            const updatedUser = await User.findByIdAndUpdate(
                userId,
                { isAppLogin: false },
                { new: true } // Return updated document
            );

            if (!updatedUser) {
                return res.status(404).json({
                    success: false,
                    message: "User not found or already deleted",
                });
            }

            // 2️⃣ Respond success
            return res.status(200).json({
                success: true,
                message: "Account deleted successfully",
            });

        } catch (error) {
            console.log("Server error: ", error.message);
            res.status(500).json({
                success: false,
                message: "Internal Server Error",
                error: error.message
            })

        }
    },

    // ****************************************************************LEAD API's**************************************************************************
    // Get All leads
    async getAllLeads(req, res) {
        try {
            const userId = req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized access" });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // Pagination inputs
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
            const skip = (page - 1) * limit;

            // Search functionality
            const search = req.query.search?.trim() || "";
            let searchFilter = {};

            if (search) {
                const isNumericSearch = !isNaN(search);

                searchFilter = {
                    $or: [
                        { "lead.name": { $regex: search, $options: "i" } },
                        { "lead.contactPersonName": { $regex: search, $options: "i" } },
                        { "lead.contactPersonEmail": { $regex: search, $options: "i" } },
                        ...(isNumericSearch ? [{ "lead.contactPersonPhone": Number(search) }] : []),
                        { "lead.enquiry": { $regex: search, $options: "i" } },
                        { "lead.siteAddress": { $regex: search, $options: "i" } },
                        { "lead.customerAddress": { $regex: search, $options: "i" } },
                        { "lead.firmCompanyGST": { $regex: search, $options: "i" } },
                        { "lead.aadharNumber": { $regex: search, $options: "i" } },
                        { "status": { $regex: search, $options: "i" } },
                    ],
                };
            }

            // Status filter logic
            let statusFilter = {};
            let excludeCustomers = {};

            if (req.query.status && req.query.status !== "all") {
                // Apply status filter if provided
                statusFilter = { status: req.query.status };
            } else {
                // By default, exclude certain statuses and isCustomer
                excludeCustomers = {
                    isCustomer: { $ne: true },
                    status: { $nin: ["Marked Defaulter", "Marked Discard", "Marked Complete", "Marked Legal"] }
                };
            }

            let addedByFilter = {};
            if (req.query.addedBy) {
                addedByFilter = { addedBy: req.query.addedBy };
            }

            // Combine filters
            const combinedFilter = { ...searchFilter, ...statusFilter, ...excludeCustomers, ...addedByFilter };

            // 🔒 Role-based visibility filter
            let accessFilter = {};

            if (user.role?.toLowerCase() === "admin") {
                // Admin sees everything
                accessFilter = {};
            } else {
                // Non-admin sees only leads they added or were assigned to
                accessFilter = {
                    $or: [
                        { addedBy: userId },
                        { "leadAllotedTo.user": userId.toString() } // since user is stored as string
                    ]
                };
            }

            // Combine both
            const finalFilter = { ...combinedFilter, ...accessFilter };

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const excludeLeadsWithFollowUps = {
                $or: [
                    { "leadFollowUps.nextFollowUpDate": { $gte: today } },
                    { "quotation.followUps.followUpDate": { $gte: today } },
                    { "billing.followUps.followUpDate": { $gte: today } },
                ],
            };

            // const finalFilter = {
            //     ...combinedFilter,
            //     $nor: [excludeLeadsWithFollowUps],
            // };

            const effectiveFilter = {
                ...finalFilter,
                $nor: [excludeLeadsWithFollowUps],
            };

            // Total count for pagination and defaulters
            const [totalLeads, totalDefaulters, leads] = await Promise.all([
                leadOrder.countDocuments(effectiveFilter),
                leadOrder.countDocuments({ status: "Marked Defaulter" }),
                leadOrder.find(effectiveFilter)
                    .populate("addedBy", "name email")
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit),
            ]);

            if (!leads.length) {
                return res.status(200).json({
                    success: true,
                    message: "No leads found",
                    totalLeads,
                    totalDefaulters,
                    page,
                    pages: 0,
                    data: []
                });
            }

            res.status(200).json({
                success: true,
                count: leads.length,
                data: leads,
                totalLeads,
                totalDefaulters,
                pagination: {
                    page,
                    limit,
                    totalPages: Math.ceil(totalLeads / limit),
                },
            });

        } catch (err) {
            console.error("Error in getAllLeads:", err);
            res.status(500).json({ success: false, message: "Internal server error" });
        }
    },

    // Get All Customer Leads
    async getCustomerLeads(req, res) {
        try {
            const userId = req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized access" });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // Pagination inputs with validation
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10)); // secure: max 50
            const skip = (page - 1) * limit;

            // Search functionality
            const search = req.query.search?.trim() || "";
            let searchFilter = {};

            if (search) {
                const isNumericSearch = !isNaN(search); // check if search is number

                searchFilter = {
                    $or: [
                        { "lead.name": { $regex: search, $options: "i" } },
                        { "lead.contactPersonName": { $regex: search, $options: "i" } },
                        { "lead.contactPersonEmail": { $regex: search, $options: "i" } },
                        ...(isNumericSearch ? [{ "lead.contactPersonPhone": Number(search) }] : []),
                        { "lead.enquiry": { $regex: search, $options: "i" } },
                        { "lead.siteAddress": { $regex: search, $options: "i" } },
                        { "lead.customerAddress": { $regex: search, $options: "i" } },
                        { "lead.firmCompanyGST": { $regex: search, $options: "i" } },
                        { "lead.aadharNumber": { $regex: search, $options: "i" } },
                        { "status": { $regex: search, $options: "i" } },
                    ],
                };
            }

            // Optional status filter
            const statusFilter =
                req.query.status && req.query.status !== "all"
                    ? { status: req.query.status }
                    : {};

            // Include only customer leads
            const customerFilter = { isCustomer: true };

            // 🧠 Core Permission Logic
            // If user cannot view all customers, restrict to their own added leads
            let visibilityFilter = {};

            // if (!user.isCustomerView) {
            //     visibilityFilter = { addedBy: userId };
            // }

            if (!user.isCustomerView) {
                // 🟢 Show leads added by user OR assigned to them in leadAllotedTo
                visibilityFilter = {
                    $or: [
                        { addedBy: userId },
                        { "leadAllotedTo.user": userId.toString() } // ensure string match
                    ],
                };
            }


            let addedByFilter = {};
            if (req.query.addedBy) {
                addedByFilter = { addedBy: req.query.addedBy };
            }

            // Combine filters
            const combinedFilter = { ...searchFilter, ...statusFilter, ...customerFilter, ...visibilityFilter, ...addedByFilter };

            // Total count for pagination and defaulters
            const [totalLeads, totalDefaulters, leads] = await Promise.all([
                leadOrder.countDocuments(combinedFilter),
                leadOrder.countDocuments({ status: "Marked Defaulter", isCustomer: true, ...visibilityFilter, }),
                leadOrder.find(combinedFilter)
                    .populate("addedBy", "name email")
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit),
            ]);

            if (!leads.length) {
                return res.status(200).json({
                    success: true,
                    message: "No customer leads found",
                    totalLeads,
                    totalDefaulters,
                    page,
                    pages: 0,
                    data: []
                });
            }

            res.status(200).json({
                success: true,
                count: leads.length,
                data: leads,
                totalLeads,
                totalDefaulters,
                pagination: {
                    page,
                    limit,
                    totalPages: Math.ceil(totalLeads / limit),
                },
            });

        } catch (err) {
            console.error("Error in getCustomerLeads:", err);
            res.status(500).json({ success: false, message: "Internal server error" });
        }
    },

    // Get Leads or Customers
    async getLeadAndCustomers(req, res) {
        try {
            const userId = req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized access" });
            }

            const user = await User.findById(userId).select("-password");
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // Query type (lead or customer)
            const type = req.query.type?.toLowerCase();
            if (!["lead", "customer"].includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid type. Use ?type=lead or ?type=customer",
                });
            }

            // Pagination setup
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
            const skip = (page - 1) * limit;

            // Search functionality
            const search = req.query.search?.trim() || "";
            let searchFilter = {};

            if (search) {
                const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const escapedSearch = escapeRegex(search);
                const isNumericSearch = !isNaN(search);

                searchFilter = {
                    $or: [
                        { "lead.name": { $regex: escapedSearch, $options: "i" } },
                        { "lead.enquiry": { $regex: escapedSearch, $options: "i" } },
                        { "lead.siteAddress": { $regex: escapedSearch, $options: "i" } },
                        { "lead.contactPersonInfo.contactPersonName": { $regex: escapedSearch, $options: "i" } },
                        { "lead.contactPersonInfo.contactPersonEmail": { $regex: escapedSearch, $options: "i" } },
                        ...(isNumericSearch
                            ? [{ "lead.contactPersonInfo.contactPersonPhone": Number(search) }]
                            : []),
                    ],
                };
            }

            // Status filter
            const statusFilter =
                req.query.status && req.query.status !== "all"
                    ? { status: req.query.status }
                    : {};

            // Type filter
            // ✅ Fix: handle both lead and customer correctly
            const typeFilter =
                type === "customer"
                    ? { isCustomer: true }
                    : { $or: [{ isCustomer: { $exists: false } }, { isCustomer: false }] };

            // Role-based visibility
            let visibilityFilter = {};
            // if (user.role?.toLowerCase() !== "admin") {
            //     // Fix: Some leads store leadAllotedTo.user as string, some as ObjectId
            //     visibilityFilter = {
            //         $or: [
            //             { addedBy: userId },
            //             { "leadAllotedTo.user": userId.toString() },
            //             { "leadAllotedTo.user": userId },
            //         ],
            //     };
            // }

            // Optional addedBy filter
            const addedByFilter = req.query.addedBy
                ? { addedBy: req.query.addedBy }
                : {};

            // Combine all filters properly
            const finalFilter = {
                $and: [
                    searchFilter,
                    statusFilter,
                    typeFilter,
                    visibilityFilter,
                    addedByFilter,
                ].filter((f) => Object.keys(f).length > 0),
            };

            // 🔍 Debug log (optional)
            // console.log("Final Filter:", JSON.stringify(finalFilter, null, 2));

            // Fetch results
            const [totalLeads, leads] = await Promise.all([
                leadOrder.countDocuments(finalFilter),
                leadOrder.find(finalFilter)
                    .populate("addedBy", "name email")
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .select({
                        "lead.name": 1,
                        "lead.siteAddress": 1,
                        "lead.enquiry": 1,
                        "lead.contactPersonInfo": 1,
                    }),
            ]);

            if (!leads.length) {
                return res.status(200).json({
                    success: true,
                    message: type === "customer" ? "No customer leads found" : "No leads found",
                    totalLeads,
                    page,
                    pages: 0,
                    data: [],
                });
            }

            res.status(200).json({
                success: true,
                type,
                count: leads.length,
                data: leads,
                totalLeads,
                pagination: {
                    page,
                    limit,
                    totalPages: Math.ceil(totalLeads / limit),
                },
            });

        } catch (err) {
            console.error("Error in getLeadAndCustomers:", err);
            res.status(500).json({ success: false, message: "Internal server error" });
        }
    },

    // Punch In
    async punchIn(req, res) {
        try {
            const userId = req.user?._id;
            const {
                type,
                companyName,
                visitCompanyName,
                loginLocation,
                logoutLocation,
                remarks
            } = req.body;

            const parseIfString = (value) => {
                if (!value) return value;
                try {
                    if (typeof value === "string") {
                        const clean = value.replace(/\n/g, "").trim();
                        return JSON.parse(clean);
                    }
                    return value;
                } catch {
                    return value;
                }
            };

            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            if (!type || !["checkIn", "checkOut"].includes(type)) {
                return res.status(400).json({ success: false, message: "Invalid type. Use 'checkIn' or 'checkOut'." });
            }

            const parsedLoginLocation = parseIfString(loginLocation);
            const parsedLogoutLocation = parseIfString(logoutLocation);
            const parsedVisitCompanyName = parseIfString(visitCompanyName);
            const parsedRemarks = parseIfString(remarks);

            const now = new Date();
            const today = now.toISOString().split("T")[0];

            if (type === "checkIn") {

                // Validate company selection
                if (!companyName && !visitCompanyName) {
                    return res.status(400).json({
                        success: false,
                        message: "Please provide either 'companyName' or 'visitCompanyName'. One is required.",
                    });
                }

                if (companyName && visitCompanyName) {
                    return res.status(400).json({
                        success: false,
                        message: "Please provide only one: either 'companyName' or 'visitCompanyName', not both.",
                    });
                }

                // ✅ If visitCompanyName is provided, validate its fields
                if (visitCompanyName) {
                    const parsedVisitCompanyName = parseIfString(visitCompanyName);

                    // Check if valid object with required keys
                    if (
                        !parsedVisitCompanyName ||
                        typeof parsedVisitCompanyName !== "object" ||
                        !parsedVisitCompanyName.name ||
                        !parsedVisitCompanyName.siteAddress
                    ) {
                        return res.status(400).json({
                            success: false,
                            message: "Invalid 'visit Company Name' data. 'name' and 'siteAddress' are required fields.",
                        });
                    }
                }


                // Check if there is an active visit today
                const activeVisitToday = await VisitData.findOne({
                    addedBy: userId,
                    logoutAt: null,
                    loginAt: {
                        $gte: new Date(today + "T00:00:00"),
                        $lte: new Date(today + "T23:59:59"),
                    }
                });

                if (activeVisitToday) {
                    return res.status(400).json({
                        success: false,
                        message: "You already have a pending visit today. Please check out first.",
                    });
                }

                // Handle media uploads
                let uploadedMedia = [];
                if (req.files && req.files.media) {
                    for (const file of req.files.media) {
                        const s3Result = await uploadToS3(file.buffer, file.originalname, file.mimetype);
                        uploadedMedia.push(s3Result.Location);
                    }
                }

                // Create new visit
                const newVisit = new VisitData({
                    addedBy: userId,
                    login: true,
                    loginAt: now,
                    logoutAt: null,
                    loginLocation: parsedLoginLocation || {},
                    remarks: parsedRemarks
                        ? [
                            {
                                note: parsedRemarks.note || "",
                                followUpDate: parsedRemarks.followUpDate ? new Date(parsedRemarks.followUpDate) : null,
                                media: uploadedMedia,
                            },
                        ]
                        : uploadedMedia.length
                            ? [{ note: "", media: uploadedMedia }]
                            : [],
                });

                // Company assignment
                if (companyName) {
                    const leadExists = await leadOrder.findById(companyName);
                    if (!leadExists) {
                        return res.status(400).json({ success: false, message: "Lead or Customer not found." });
                    }
                    newVisit.companyName = companyName;
                } else if (parsedVisitCompanyName) {
                    newVisit.visitCompanyName = parsedVisitCompanyName;
                }

                await newVisit.save();

                // 🔥 Populate lead details if companyName exists
                const populatedVisit = await VisitData.findById(newVisit._id)
                    .populate({
                        path: "companyName",
                        select: "lead.name lead.siteAddress lead.enquiry lead.contactPersonInfo"
                    });

                return res.status(201).json({ success: true, message: "Check in recorded successfully.", data: populatedVisit });
            }

            if (type === "checkOut") {
                // Find last active visit
                const activeVisit = await VisitData.findOne({
                    addedBy: userId,
                    logoutAt: null
                }).sort({ createdAt: -1 });

                if (!activeVisit) {
                    return res.status(400).json({
                        success: false,
                        message: "No active visit found to check out.",
                    });
                }

                // Update only logoutAt and logoutLocation
                activeVisit.logoutAt = now;
                activeVisit.logoutLocation = parsedLogoutLocation || {};
                // activeVisit.loginLocation = parsedLoginLocation || {};
                activeVisit.login = false;

                // Optional remarks/media
                let uploadedMedia = [];
                if (req.files && req.files.media) {
                    for (const file of req.files.media) {
                        const s3Result = await uploadToS3(file.buffer, file.originalname, file.mimetype);
                        uploadedMedia.push(s3Result.Location);
                    }
                }

                if (parsedRemarks?.note || uploadedMedia.length > 0) {
                    activeVisit.remarks.push({
                        note: parsedRemarks.note || "",
                        followUpDate: parsedRemarks.followUpDate ? new Date(parsedRemarks.followUpDate) : null,
                        media: uploadedMedia,
                        createdAt: new Date(),
                    });
                }

                await activeVisit.save();
                return res.status(200).json({ success: true, message: "Check out recorded successfully.", data: activeVisit });
            }

        } catch (error) {
            console.error("Check Error:", error);
            return res.status(500).json({ success: false, message: "Server error", error: error.message });
        }
    },

    // Add Visit Remark
    async addVisitRemark(req, res) {
        try {
            const userId = req.user?._id;
            const visitId = req.params.id;

            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            // 🟢 Find the visit
            const visit = await VisitData.findById(visitId);
            if (!visit) {
                return res.status(404).json({ success: false, message: "Visit not found" });
            }

            // 🔒 Check if visit is active
            if (!visit.login || visit.logoutAt) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot add remarks. Visit has already been logged out.",
                });
            }

            // ✅ JSON parser
            const parseIfString = (value) => {
                try {
                    if (typeof value === "string") {
                        const clean = value.replace(/\n/g, "").trim();
                        return JSON.parse(clean);
                    }
                    return value;
                } catch {
                    return value;
                }
            };

            const parsedRemarks = parseIfString(req.body.remarks);

            let uploadedMedia = [];
            if (req.files && req.files.media) {
                for (const file of req.files.media) {
                    const s3Result = await uploadToS3(file.buffer, file.originalname, file.mimetype);
                    uploadedMedia.push(s3Result.Location);
                }
            }

            // ✅ Build new remark
            const newRemark = {
                note: parsedRemarks?.note || "",
                followUpDate: parsedRemarks?.followUpDate ? new Date(parsedRemarks.followUpDate) : null,
                media: uploadedMedia,
                createdAt: new Date(),
            };

            // ✅ Push remark and save
            visit.remarks.push(newRemark);
            await visit.save();

            return res.status(200).json({
                success: true,
                message: "Remark added successfully.",
                data: newRemark,
            });
        } catch (error) {
            console.error("Add Remark Error:", error);
            res.status(500).json({
                success: false,
                message: "Server error",
                error: error.message,
            });
        }
    },

    // Get current user's last visit status
    async getLoginStatus(req, res) {
        try {
            const userId = req.user?._id;

            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            // Find the last visit of the user
            const lastVisit = await VisitData.findOne({ addedBy: userId })
                .sort({ createdAt: -1 })
                .populate({
                    path: "companyName",
                    select: "lead.name lead.siteAddress lead.enquiry lead.contactPersonInfo",
                });


            if (!lastVisit) {
                // No visit yet → login false
                return res.status(200).json({ success: true, login: false, data: null });
            }

            const now = new Date();
            const today = now.toISOString().split("T")[0]; // YYYY-MM-DD
            const lastVisitDate = lastVisit.loginAt.toISOString().split("T")[0];

            // If the last visit is not today, login is false
            if (lastVisitDate !== today) {
                return res.status(200).json({ success: true, login: false, data: null });
            }

            // If login is true and not logged out
            if (lastVisit.login && !lastVisit.logoutAt) {
                return res.status(200).json({ success: true, login: true, data: lastVisit });
            } else {
                return res.status(200).json({ success: true, login: false });
            }

        } catch (error) {
            console.error("Get Login Status Error:", error);
            return res.status(500).json({ success: false, message: "Server error", error: error.message });
        }
    },
};

module.exports = managerAppController;

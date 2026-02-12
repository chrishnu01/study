const User = require('../models/User');
const leadOrder = require('../models/Case')
const QuotationItem = require('../models/QuotationItems')
const VisitData = require('../models/VisitsData')
const Units = require('../models/Units')
const Sources = require('../models/Source')
const TermCondition = require('../models/TermsCondition')
const jwt = require('jsonwebtoken');
const bcrypt = require("bcrypt")
const uploadToS3 = require('../utils/s3')
const html_to_pdf = require("html-pdf-node");
const generateQuotationTemplate = require("../utils/generateQuotationTemplate");
const deleteS3File = require("../utils/s3Delete")
const mongoose = require("mongoose");
const getNextSequence = require("../utils/getNextSequence");
const generateSaleQuotationTemplate = require('../utils/generateSaleQuotationTemplate');

// Convert daysRsInAdvance to months and days
function convertDaysToMonthsDays(totalDays) {
    const months = Math.floor(totalDays / 30);
    const days = totalDays % 30;
    return `${months} month(s)${days > 0 ? ` and ${days} day(s)` : ""}`;
}

// --- helpers ---
const safeParse = (val) => {
    if (typeof val !== 'string') return val;
    try {
        return JSON.parse(val);
    } catch (e) {
        return val;
    }
};

function toDateIfPossible(value) {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
}


const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        const srcVal = source[key];
        if (srcVal instanceof Date) {
            target[key] = srcVal;
        } else if (isObject(srcVal) && isObject(target[key])) {
            target[key] = deepMerge(target[key], srcVal);
        } else if (srcVal !== undefined) {
            target[key] = srcVal;
        }
        if (isObject(srcVal) && isObject(target[key])) {
            target[key] = deepMerge(target[key], srcVal);
        } else {
            target[key] = srcVal;
        }
    }
    return target;
}


const getNested = (obj, path) => {
    if (!path) return undefined;
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
};

// Helper map for section/sub-section
const sectionMap = {
    order: "orderData",
    dispatch: "dispatchData",
    return: "returnData",
    billing: "billingData",
    payment: "paymentData",
};

// Utility function for consistent rounding
const roundTo3 = (num) => Number(Number(num || 0).toFixed(3));

// Top of your controller file
const truncateTo3 = (num) => {
    if (typeof num !== "number" || isNaN(num)) return 0;
    return Math.floor(num * 1000) / 1000;
};

const userController = {

    // ****************************************************************USER API's**************************************************************************
    // Login User
    async userLogin(req, res) {
        try {
            const resp = await User.findOne({ email: req.body.email });
            if (!resp) {
                return res.status(200).json({
                    success: false,
                    message: "Email not found",
                });
            }

            bcrypt.compare(req.body.password, resp.password, function (err, result) {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: "Error during password comparison",
                    });
                }

                if (result) {
                    const token = jwt.sign(
                        {
                            id: resp._id,
                            role: resp.role,
                            isDeletable: resp.isDeletable,
                            isEditable: resp.isEditable,
                            isVisitView: resp.isVisitView,
                            isAppLogin: resp.isAppLogin,
                            isCustomerView: resp.isCustomerView,
                        },
                        process.env.JWT_SECRET,
                        { expiresIn: "24h" }
                    );
                    return res.status(200).json({
                        success: true,
                        message: "Login Successfully",
                        token,
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

    // Register User
    async registerUser(req, res) {
        try {
            const { name, email, password, phone, role } = req.body;

            // Required fields validation
            if (!name || !email || !password || !phone || !role) {
                return res.status(400).json({ success: false, message: "All fields are required" });
            }

            // // Prevent creating Admin role
            if (role === "Admin" || role === "admin") {
                return res.status(400).json({ success: false, message: `Cannot create user with ${role} role` });
            }

            // Check for existing admin by email
            const existingEmail = await User.findOne({ email });
            if (existingEmail) {
                return res.status(400).json({ success: false, message: "User with this email already exists" });
            }

            // Check for existing admin by phone
            const existingPhone = await User.findOne({ phone });
            if (existingPhone) {
                return res.status(400).json({ success: false, message: "User with this phone number already exists" });
            }

            // Set permissions based on role
            const isAdmin = role === "Admin";
            // Create new admin
            const newUser = new User({
                name,
                email,
                password, // Password will be hashed in model
                phone,
                role,
                isEditable: isAdmin,
                isDeletable: isAdmin,
            });

            await newUser.save();

            return res.status(201).json({
                success: true,
                message: "User registered successfully",
            });

        } catch (error) {
            console.error("Error registering user:", error);
            return res.status(500).json({ success: false, message: "Internal Server Error" });
        }
    },

    // Get User
    async getUser(req, res) {
        try {
            const userId = req.user._id; // from auth middleware

            const user = await User.findById(userId);
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

    // Get All User
    async getAllUsers(req, res) {
        try {
            const userId = req.user?._id;
            if (!userId)
                return res.status(401).json({ success: false, message: "Unauthorized access" });

            const currentUser = await User.findById(userId);
            if (!currentUser)
                return res.status(404).json({ success: false, message: "User not found" });

            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
            const skip = (page - 1) * limit;

            const { filterType, filterValue, from, to, search } = req.query;

            // 🕒 Step 1: Build date filter for LEADS (not users)
            let leadDateFilter = {};

            if (from && to) {
                const start = new Date(from);
                let end = new Date(to);

                if (filterType === "month") {
                    end = new Date(end.getFullYear(), end.getMonth() + 1, 0, 23, 59, 59, 999);
                } else if (filterType === "year") {
                    end = new Date(end.getFullYear(), 11, 31, 23, 59, 59, 999);
                } else {
                    end.setHours(23, 59, 59, 999);
                }

                leadDateFilter = { createdAt: { $gte: start, $lte: end } };
            } else if (filterType && filterValue) {
                const start = new Date(filterValue);
                let end = new Date(start);

                if (filterType === "date") {
                    end.setDate(start.getDate() + 1);
                } else if (filterType === "month") {
                    end.setMonth(start.getMonth() + 1);
                } else if (filterType === "year") {
                    end.setFullYear(start.getFullYear() + 1);
                }

                leadDateFilter = { createdAt: { $gte: start, $lt: end } };
            }

            // 🧍 Step 2: Fetch users
            let userQuery = {};
            if (search && search.trim() !== "") {
                const regex = new RegExp(search.trim(), "i");
                userQuery = {
                    $or: [
                        { name: regex },
                        { email: regex },
                        { phone: regex },
                        { role: regex },
                    ],
                };
            }

            const totalUsers = await User.countDocuments(userQuery);
            const users = await User.find(userQuery)
                .select("-password -addedLead")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            // 🧾 Step 3: Aggregate user flags
            const userFlags = await User.aggregate([
                {
                    $group: {
                        _id: null,
                        editableCount: { $sum: { $cond: ["$isEditable", 1, 0] } },
                        deletableCount: { $sum: { $cond: ["$isDeletable", 1, 0] } },
                        appLoginCount: { $sum: { $cond: ["$isAppLogin", 1, 0] } },
                        customerViewCount: { $sum: { $cond: ["$isCustomerView", 1, 0] } },
                    },
                },
            ]);

            // 📊 Step 4: Aggregate lead stats
            const leadStats = await leadOrder.aggregate([
                { $match: leadDateFilter },
                {
                    $group: {
                        _id: "$addedBy",
                        totalLeads: { $sum: 1 },
                        totalCustomers: { $sum: { $cond: ["$isCustomer", 1, 0] } },
                        totalNonCustomers: { $sum: { $cond: [{ $not: ["$isCustomer"] }, 1, 0] } },
                    },
                },
            ]);

            // 📦 Step 5: Aggregate total allotted leads (NEW)
            const allotedStats = await leadOrder.aggregate([
                { $unwind: "$leadAllotedTo" },
                {
                    $group: {
                        _id: "$leadAllotedTo.user",
                        totalAllotedLeads: { $sum: 1 },
                    },
                },
            ]);

            // Create lookup maps for faster merging
            const leadMap = leadStats.reduce((acc, l) => {
                acc[l._id?.toString()] = l;
                return acc;
            }, {});

            const allotedMap = allotedStats.reduce((acc, a) => {
                acc[a._id?.toString()] = a.totalAllotedLeads;
                return acc;
            }, {});

            // 🧩 Step 6: Merge stats into user data
            const mergedUsers = users.map((u) => ({
                ...u.toObject(),
                stats: {
                    totalLeads: leadMap[u._id]?.totalLeads || 0,
                    totalCustomers: leadMap[u._id]?.totalCustomers || 0,
                    totalNonCustomers: leadMap[u._id]?.totalNonCustomers || 0,
                    totalAllotedLeads: allotedMap[u._id] || 0, // ✅ New field
                },
            }));

            // ✅ Step 7: Return response
            res.status(200).json({
                success: true,
                count: mergedUsers.length,
                data: mergedUsers,
                userFlags: userFlags[0] || {
                    editableCount: 0,
                    deletableCount: 0,
                    appLoginCount: 0,
                    customerViewCount: 0,
                },
                pagination: {
                    page,
                    limit,
                    totalUsers,
                    totalPages: Math.ceil(totalUsers / limit),
                },
                appliedFilter: { filterType, from, to, filterValue, search },
            });
        } catch (err) {
            console.error("Error in getAllUsers:", err);
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: err.message,
            });
        }
    },

    // Delete User
    async deleteUser(req, res) {
        try {
            const userId = req.user._id; // from auth middleware

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const deletedUser = await User.findByIdAndDelete(userId);

            if (!deletedUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            res.status(200).json({
                success: true,
                message: 'User deleted successfully',
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Server Error',
                error: error.message,
            });
        }
    },

    // Delete Selected User
    async deleteSelectedUser(req, res) {
        try {
            const userId = req.user._id; // from auth middleware
            const { id } = req.params

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const deletedUser = await User.findByIdAndDelete(id);

            if (!deletedUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            res.status(200).json({
                success: true,
                message: 'User deleted successfully',
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Server Error',
                error: error.message,
            });
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

    // Change User permission
    async changePermission(req, res) {
        try {
            const currentUserId = req.user._id; // logged-in user
            const { targetUserId } = req.params; // user to change permissions
            const { isEditable, isDeletable, isCustomerView, isAppLogin, isVisitView } = req.body; // new permission values

            // ✅ Only Admins can change permissions
            const currentUser = await User.findById(currentUserId);
            if (!currentUser) {
                return res.status(404).json({ success: false, message: 'Current user not found' });
            }

            if (currentUser.role !== 'Admin') {
                return res.status(403).json({ success: false, message: 'Only Admins can change permissions' });
            }

            // ✅ Find target user
            const targetUser = await User.findById(targetUserId);
            if (!targetUser) {
                return res.status(404).json({ success: false, message: 'Target user not found' });
            }

            // Track changes
            const changes = [];

            if (typeof isEditable === 'boolean' && isEditable !== targetUser.isEditable) {
                changes.push(`isEditable: ${targetUser.isEditable} → ${isEditable}`);
                targetUser.isEditable = isEditable;
            }

            if (typeof isDeletable === 'boolean' && isDeletable !== targetUser.isDeletable) {
                changes.push(`isDeletable: ${targetUser.isDeletable} → ${isDeletable}`);
                targetUser.isDeletable = isDeletable;
            }

            if (typeof isCustomerView === 'boolean' && isCustomerView !== targetUser.isCustomerView) {
                changes.push(`isCustomerView: ${targetUser.isCustomerView} → ${isCustomerView}`);
                targetUser.isCustomerView = isCustomerView;
            }

            if (typeof isAppLogin === 'boolean' && isAppLogin !== targetUser.isAppLogin) {
                changes.push(`isAppLogin: ${targetUser.isAppLogin} → ${isAppLogin}`);
                targetUser.isAppLogin = isAppLogin;
            }

            if (typeof isVisitView === 'boolean' && isVisitView !== targetUser.isVisitView) {
                changes.push(`isVisitView: ${targetUser.isVisitView} → ${isVisitView}`);
                targetUser.isVisitView = isVisitView;
            }

            if (changes.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: 'No changes were made',
                    data: targetUser
                });
            }

            await targetUser.save();

            res.status(200).json({
                success: true,
                message: `Updated permissions: ${changes.join(', ')}`,
                data: {
                    _id: targetUser._id,
                    name: targetUser.name,
                    email: targetUser.email,
                    isEditable: targetUser.isEditable,
                    isDeletable: targetUser.isDeletable,
                    isCustomerView: targetUser.isCustomerView,
                    isAppLogin: targetUser.isAppLogin,
                    isVisitView: targetUser.isVisitView,
                }
            });

        } catch (error) {
            console.error("Change Permission error:", error);
            res.status(500).json({
                success: false,
                message: 'Server Error',
                error: error.message,
            });
        }
    },

    // ****************************************************************LEAD API's**************************************************************************
    // Create Lead
    async createLead(req, res) {
        try {
            const userId = req.user._id; // from auth middleware

            // Check if user exists
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // Destructure lead details from request body
            const {
                name,                     // Company or organization name
                contactPersonName,        // Name of contact person
                contactPersonEmail,
                contactPersonPhone,
                enquiry,                  // Enquiry message
                siteAddress,
                customerAddress,
                source,
                contactPersonInfo
            } = req.body;

            // ✅ Validate all required fields
            if (
                !name
                //||
                // !contactPersonName ||
                // !contactPersonEmail ||
                // !contactPersonPhone ||
                // !enquiry ||
                // !siteAddress ||
                // !customerAddress
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Company name is required",
                });
            }

            // 🚫 Prevent duplicate leads with same name
            const existingLead = await leadOrder.findOne({ "lead.name": { $regex: new RegExp(`^${name}$`, "i") } });
            if (existingLead) {
                return res.status(400).json({
                    success: false,
                    message: `A lead with the company name "${name}" already exists.`,
                });
            }

            // ✅ Ensure contactPersonPhone is always an array
            let phoneArray = [];

            if (Array.isArray(contactPersonPhone)) {
                phoneArray = contactPersonPhone.filter(p => p && p.toString().trim() !== "");
            } else if (contactPersonPhone) {
                phoneArray = [contactPersonPhone];
            }

            // Optional: Validate phone number formats
            const invalidNumbers = phoneArray.filter(
                (num) => !/^\+?\d{7,15}$/.test(num.toString()) // allow + and 7–15 digits
            );
            if (invalidNumbers.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid phone number(s): ${invalidNumbers.join(", ")}`,
                });
            }

            // ✅ Normalize source array (ensure each has both fields)
            const formattedContactPersonInfo = Array.isArray(contactPersonInfo)
                ? contactPersonInfo
                    .filter((s) => s && (s.contactPersonName || s.contactPersonEmail || s.contactPersonPhone))
                    .map((s) => ({
                        contactPersonName: s.contactPersonName?.trim() || "",
                        contactPersonEmail: s.contactPersonEmail?.trim() || "",
                        contactPersonPhone: Array.isArray(s.contactPersonPhone)
                            ? s.contactPersonPhone
                                .map(num => num.toString().trim())
                                .filter(num => num !== "")
                                .map(Number)
                            : s.contactPersonPhone
                                ? [Number(s.contactPersonPhone)]
                                : [],
                    }))
                : [];

            // ✅ Normalize source array (ensure each has both fields)
            const formattedSources = Array.isArray(source)
                ? source
                    .filter((s) => s && (s.sourceName || s.reference))
                    .map((s) => ({
                        sourceName: s.sourceName?.trim() || "",
                        reference: s.reference?.trim() || "",
                    }))
                : [];

            // ✅ Create new lead entry
            const newLead = new leadOrder({
                addedBy: userId,
                status: "Lead Generated",
                lead: {
                    name,
                    contactPersonName,
                    contactPersonEmail,
                    contactPersonPhone: phoneArray,
                    enquiry,
                    siteAddress,
                    customerAddress,
                    source: formattedSources,
                    contactPersonInfo: formattedContactPersonInfo
                },
            });

            // Save lead
            const savedLead = await newLead.save();

            // ✅ Push lead ID into user's addedLead array
            user.addedLead.push(savedLead._id);
            await user.save();

            res.status(201).json({
                success: true,
                message: "Lead created successfully",
            });
        } catch (err) {
            console.error("Error creating lead:", err);
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // Update Status of lead
    async updateLeadOrder(req, res) {
        try {
            const userId = req.user._id;
            const user = await User.findById(userId);
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });

            const { id } = req.params;
            const lead = await leadOrder.findById(id);
            if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

            // ────────────────────────────────────────────────
            // 📸 SNAPSHOT BEFORE ANY MUTATIONS (USE LEAN FOR CLEAN SNAPSHOT)
            // ────────────────────────────────────────────────
            const originalLead = await leadOrder
                .findById(id)
                .lean();
            const changedSections = new Set();
            const markChanged = (path) => changedSections.add(path);

            // Which top-level fields we allow to update via this endpoint:
            const allowedFields = [
                'lead',
                'order',
                'dispatch',
                'return',
                'billing',
                'payment',
                'leadFollowUps',
                'aggrementDocument',
                'securityDocument',
                'isCustomer',
                'legal',
            ];

            // Build parsed updates from req.body (form-data fields arrive as strings)
            const updates = {};
            for (const key of Object.keys(req.body || {})) {
                if (!allowedFields.includes(key)) continue;
                updates[key] = safeParse(req.body[key]);
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZATION HELPERS
            // ────────────────────────────────────────────────
            const normalizeFirstIfArray = (v) => (Array.isArray(v) && v.length > 0 ? v[0] : v);

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE ORDER
            // ────────────────────────────────────────────────
            if (updates.order !== undefined) {
                markChanged('order');
                const raw = normalizeFirstIfArray(updates.order);
                const parsed = safeParse(raw);
                const normalizedOrder = {};

                if (parsed.orderId) normalizedOrder.orderId = parsed.orderId;
                else if (parsed.orderNumber) normalizedOrder.orderId = parsed.orderNumber;

                if (parsed.createdDate) normalizedOrder.createdDate = toDateIfPossible(parsed.createdDate);
                else if (parsed.deliveryDate) normalizedOrder.createdDate = toDateIfPossible(parsed.deliveryDate);

                if (parsed.documents)
                    normalizedOrder.documents = Array.isArray(parsed.documents)
                        ? parsed.documents
                        : [parsed.documents];

                // Handle nested orderData array
                if (parsed.orderData && Array.isArray(parsed.orderData)) {
                    const formattedOrderData = parsed.orderData.map((item) => ({
                        orderId: item.orderId || "",
                        createdDate: toDateIfPossible(item.createdDate) || new Date(),
                        documents: Array.isArray(item.documents) ? item.documents : [item.documents].filter(Boolean),
                    }));

                    const existingOrderData = lead.order?.orderData || [];
                    normalizedOrder.orderData = [...existingOrderData, ...formattedOrderData];
                    lead.markModified('order.orderData');
                    markChanged('order.orderData');
                }

                updates.order = normalizedOrder;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE DISPATCH
            // ────────────────────────────────────────────────
            if (updates.dispatch !== undefined) {
                markChanged('dispatch');
                const raw = normalizeFirstIfArray(updates.dispatch);
                const parsed = safeParse(raw);
                const normalized = {};

                if (parsed.mrnNumber) normalized.mrnNumber = parsed.mrnNumber;
                if (parsed.dispatchDate) normalized.dispatchDate = toDateIfPossible(parsed.dispatchDate);
                if (parsed.documents)
                    normalized.documents = Array.isArray(parsed.documents)
                        ? parsed.documents
                        : [parsed.documents];

                // Handle nested dispatchData array
                if (parsed.dispatchData && Array.isArray(parsed.dispatchData)) {
                    const formattedDispatchData = parsed.dispatchData.map((item) => ({
                        mrnNumber: item.mrnNumber || "",
                        dispatchDate: toDateIfPossible(item.dispatchDate) || new Date(),
                        documents: Array.isArray(item.documents) ? item.documents : [item.documents].filter(Boolean),
                    }));

                    const existingDispatchData = lead.dispatch?.dispatchData || [];
                    normalized.dispatchData = [...existingDispatchData, ...formattedDispatchData];
                    lead.markModified('dispatch.dispatchData');
                    markChanged('dispatch.dispatchData');
                }

                updates.dispatch = normalized;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE RETURN
            // ────────────────────────────────────────────────
            if (updates.return !== undefined) {
                markChanged('return');
                const raw = normalizeFirstIfArray(updates.return);
                const parsed = safeParse(raw);
                const normalized = {};

                if (parsed.returnNumber) normalized.returnNumber = parsed.returnNumber;
                if (parsed.returnDate) normalized.returnDate = toDateIfPossible(parsed.returnDate);
                if (parsed.documents)
                    normalized.documents = Array.isArray(parsed.documents)
                        ? parsed.documents
                        : [parsed.documents];

                // Handle nested returnData array
                if (parsed.returnData && Array.isArray(parsed.returnData)) {
                    const formattedReturnData = parsed.returnData.map((item) => ({
                        returnNumber: item.returnNumber || "",
                        returnDate: toDateIfPossible(item.returnDate) || new Date(),
                        documents: Array.isArray(item.documents) ? item.documents : [item.documents].filter(Boolean),
                    }));

                    const existingReturnData = lead.return?.returnData || [];
                    normalized.returnData = [...existingReturnData, ...formattedReturnData];
                    lead.markModified('return.returnData');
                    markChanged('return.returnData');
                }

                updates.return = normalized;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE BILLING
            // ────────────────────────────────────────────────
            if (updates.billing !== undefined) {
                markChanged('billing');
                const raw = normalizeFirstIfArray(updates.billing);
                const parsed = safeParse(raw);
                const normalized = {};
                if (parsed.billNumber) normalized.billNumber = parsed.billNumber;
                if (parsed.amount !== undefined) normalized.amount = Number(parsed.amount);
                if (parsed.taxPercentage !== undefined) normalized.taxPercentage = Number(parsed.taxPercentage);
                if (parsed.totalAmount !== undefined) normalized.totalAmount = Number(parsed.totalAmount);
                if (parsed.dueDate) normalized.dueDate = toDateIfPossible(parsed.dueDate);
                if (parsed.billDate) normalized.billDate = toDateIfPossible(parsed.billDate);
                if (parsed.billFiles) normalized.billFiles = Array.isArray(parsed.billFiles) ? parsed.billFiles : [parsed.billFiles];
                for (const k of Object.keys(parsed)) {
                    if (!['billNumber', 'amount', 'taxPercentage', 'totalAmount', 'dueDate', 'billDate', 'billFiles'].includes(k)) normalized[k] = parsed[k];
                }
                updates.billing = normalized;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE LEGAL
            // ────────────────────────────────────────────────
            if (updates.legal !== undefined) {
                markChanged('legal');
                const raw = normalizeFirstIfArray(updates.legal);
                const parsed = safeParse(raw);

                const normalized = {};
                if (parsed.case) normalized.case = parsed.case;
                if (parsed.advocate) normalized.advocate = parsed.advocate;
                if (parsed.remarks) normalized.remarks = parsed.remarks;
                if (parsed.nextDate) normalized.nextDate = toDateIfPossible(parsed.nextDate);
                if (parsed.followUps) normalized.followUps = parsed.followUps;

                updates.legal = normalized;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE AGREEMENT/SECURITY DOCUMENTS (APPEND)
            // ────────────────────────────────────────────────
            ['aggrementDocument', 'securityDocument'].forEach((docKey) => {
                if (updates[docKey] !== undefined) {
                    markChanged(docKey);
                    markChanged(`${docKey}.documents`);
                    const raw = normalizeFirstIfArray(updates[docKey]);
                    const parsed = safeParse(raw);

                    let parsedDocuments = [];
                    if (Array.isArray(parsed)) {
                        parsedDocuments = parsed;
                    } else if (isObject(parsed) && parsed.documents) {
                        parsedDocuments = Array.isArray(parsed.documents) ? parsed.documents : [parsed.documents];
                    } else if (isObject(parsed)) {
                        // If it's an object without documents key, preserve it but ensure documents array
                        updates[docKey] = {
                            ...parsed,
                            documents: [...(lead[docKey]?.documents || []), ...(parsed.documents ? (Array.isArray(parsed.documents) ? parsed.documents : [parsed.documents]) : [])]
                        };
                        return; // Early return to skip below logic
                    }

                    // Append to existing documents
                    updates[docKey] = {
                        documents: [
                            ...(lead[docKey]?.documents || []),
                            ...parsedDocuments
                        ]
                    };
                }
            });

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE LEAD FOLLOW-UPS (APPEND SAFELY)
            // ────────────────────────────────────────────────
            if (updates.leadFollowUps !== undefined) {
                markChanged('leadFollowUps');
                const parsedFollowUps = Array.isArray(updates.leadFollowUps)
                    ? updates.leadFollowUps.map((item) => {
                        const it = safeParse(item);
                        it.user = userId;
                        if (it.nextFollowUpDate) it.nextFollowUpDate = toDateIfPossible(it.nextFollowUpDate);
                        if (it.createdAt) it.createdAt = toDateIfPossible(it.createdAt);
                        else it.createdAt = new Date();
                        return it;
                    })
                    : [{
                        ...safeParse(updates.leadFollowUps),
                        user: userId,
                        nextFollowUpDate: new Date(),
                        createdAt: new Date(),
                    }];

                const existingFollowUps = Array.isArray(lead.leadFollowUps) ? lead.leadFollowUps : [];
                lead.leadFollowUps = [...existingFollowUps, ...parsedFollowUps];
                lead.markModified('leadFollowUps');
                delete updates.leadFollowUps;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE PAYMENT FOLLOW-UPS (APPEND SAFELY)
            // ────────────────────────────────────────────────
            if (updates.payment && updates.payment.followUps) {
                markChanged('payment');
                markChanged('payment.followUps');
                const parsedFollowUps = Array.isArray(updates.payment.followUps)
                    ? updates.payment.followUps.map((item) => {
                        const it = safeParse(item);
                        if (!it.user) it.user = userId;
                        if (it.followUpDate) it.followUpDate = toDateIfPossible(it.followUpDate);
                        if (it.createdAt) it.createdAt = toDateIfPossible(it.createdAt);
                        else it.createdAt = new Date();

                        // Handle calledTo array properly
                        if (it.calledTo) {
                            if (Array.isArray(it.calledTo)) {
                                it.calledTo = it.calledTo.map((c) => ({
                                    name: c.name?.trim() || "",
                                    phone: c.phone ? Number(c.phone) : null,
                                    talk: c.talk?.trim() || "",
                                }));
                            } else if (typeof it.calledTo === "string") {
                                const parsedCalled = safeParse(it.calledTo);
                                it.calledTo = Array.isArray(parsedCalled)
                                    ? parsedCalled.map((c) => ({
                                        name: c.name?.trim() || "",
                                        phone: c.phone ? Number(c.phone) : null,
                                        talk: c.talk?.trim() || "",
                                    }))
                                    : [];
                            } else if (typeof it.calledTo === "object") {
                                it.calledTo = [{
                                    name: it.calledTo.name?.trim() || "",
                                    phone: it.calledTo.phone ? Number(it.calledTo.phone) : null,
                                    talk: it.calledTo.talk?.trim() || "",
                                }];
                            } else {
                                it.calledTo = [];
                            }
                        } else {
                            it.calledTo = [];
                        }
                        return it;
                    })
                    : [{ ...safeParse(updates.payment.followUps), user: userId }];

                const existingFollowUps = (lead.payment && lead.payment.followUps) || [];
                lead.payment = lead.payment || {};
                lead.payment.followUps = [...existingFollowUps, ...parsedFollowUps];
                lead.markModified('payment.followUps');
                delete updates.payment.followUps;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE BILLING FOLLOW-UPS (APPEND SAFELY)
            // ────────────────────────────────────────────────
            if (updates.billing && updates.billing.followUps) {
                markChanged('billing');
                markChanged('billing.followUps');
                const parsedFollowUps = Array.isArray(updates.billing.followUps)
                    ? updates.billing.followUps.map((item) => {
                        const it = safeParse(item);
                        if (!it.user) it.user = userId;
                        if (it.followUpDate) it.followUpDate = toDateIfPossible(it.followUpDate);
                        if (it.createdAt) it.createdAt = toDateIfPossible(it.createdAt);
                        else it.createdAt = new Date();
                        return it;
                    })
                    : [{
                        ...safeParse(updates.billing.followUps),
                        user: userId,
                        createdAt: new Date(),
                    }];

                const existingFollowUps = (lead.billing && lead.billing.followUps) || [];
                lead.billing = lead.billing || {};
                lead.billing.followUps = [...existingFollowUps, ...parsedFollowUps];
                lead.markModified('billing.followUps');
                delete updates.billing.followUps;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE BILLING DATA (APPEND SAFELY)
            // ────────────────────────────────────────────────
            if (updates.billing && updates.billing.billingData) {
                markChanged('billing');
                markChanged('billing.billingData');
                const parsedData = Array.isArray(updates.billing.billingData)
                    ? updates.billing.billingData.map(safeParse)
                    : [safeParse(updates.billing.billingData)];

                const formatted = parsedData.map((item) => ({
                    billNumber: item.billNumber || `BILL-${Date.now()}`,
                    amount: item.amount ? Number(item.amount) : 0,
                    billFiles: Array.isArray(item.billFiles) ? item.billFiles : [item.billFiles].filter(Boolean),
                    followUps: Array.isArray(item.followUps)
                        ? item.followUps.map((f) => ({
                            ...f,
                            user: f.user ? mongoose.Types.ObjectId(f.user) : userId,
                            followUpDate: f.followUpDate ? toDateIfPossible(f.followUpDate) : new Date(),
                            createdAt: f.createdAt ? toDateIfPossible(f.createdAt) : new Date(),
                        }))
                        : [],
                }));

                const existing = Array.isArray(lead.billing?.billingData) ? lead.billing.billingData : [];
                lead.billing = lead.billing || {};
                lead.billing.billingData = [...existing, ...formatted];
                lead.markModified("billing.billingData");
                delete updates.billing.billingData;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE PAYMENT DATA (APPEND SAFELY)
            // ────────────────────────────────────────────────
            if (updates.payment && updates.payment.paymentData) {
                markChanged('payment');
                markChanged('payment.paymentData');
                const parsedData = Array.isArray(updates.payment.paymentData)
                    ? updates.payment.paymentData.map(safeParse)
                    : [safeParse(updates.payment.paymentData)];

                const formatted = parsedData.map((item) => ({
                    status: item.status || "Pending",
                    amountPaid: item.amountPaid ? Number(item.amountPaid) : 0,
                    dueDate: item.dueDate ? toDateIfPossible(item.dueDate) : new Date(),
                    followUps: Array.isArray(item.followUps)
                        ? item.followUps.map((f) => ({
                            ...f,
                            user: f.user ? mongoose.Types.ObjectId(f.user) : userId,
                            followUpDate: f.followUpDate ? toDateIfPossible(f.followUpDate) : new Date(),
                            createdAt: f.createdAt ? toDateIfPossible(f.createdAt) : new Date(),
                        }))
                        : [],
                }));

                const existing = Array.isArray(lead.payment?.paymentData) ? lead.payment.paymentData : [];
                lead.payment = lead.payment || {};
                lead.payment.paymentData = [...existing, ...formatted];
                lead.markModified("payment.paymentData");
                delete updates.payment.paymentData;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE LEGAL FOLLOW-UPS (APPEND SAFELY)
            // ────────────────────────────────────────────────
            if (updates.legal && updates.legal.followUps) {
                markChanged('legal');
                markChanged('legal.followUps');
                const parsedFollowUps = Array.isArray(updates.legal.followUps)
                    ? updates.legal.followUps.map((item) => {
                        const it = safeParse(item);
                        if (!it.user) it.user = userId;
                        if (it.followUpDate) it.followUpDate = toDateIfPossible(it.followUpDate);
                        if (it.createdAt) it.createdAt = toDateIfPossible(it.createdAt);
                        return it;
                    })
                    : [{ ...safeParse(updates.legal.followUps), user: userId }];

                const existingFollowUps = (lead.legal && lead.legal.followUps) || [];
                lead.legal = lead.legal || {};
                lead.legal.followUps = [...existingFollowUps, ...parsedFollowUps];
                lead.markModified('legal.followUps');
                delete updates.legal.followUps;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE LEAD.CONTACT PERSON INFO
            // ────────────────────────────────────────────────
            if (updates.lead && updates.lead.contactPersonInfo !== undefined) {
                markChanged(`lead.contactPersonInfo`);
                const src = updates.lead.contactPersonInfo;

                const formattedContactPersonInfo = Array.isArray(src)
                    ? src
                        .filter((s) => s && (s.contactPersonName || s.contactPersonEmail || s.contactPersonPhone))
                        .map((s) => ({
                            contactPersonName: s.contactPersonName?.trim() || "",
                            contactPersonEmail: s.contactPersonEmail?.trim() || "",
                            contactPersonPhone: Array.isArray(s.contactPersonPhone)
                                ? s.contactPersonPhone
                                    .map(num => num?.toString().trim())
                                    .filter(num => num !== "")
                                    .map(Number)
                                : s.contactPersonPhone
                                    ? [Number(s.contactPersonPhone)]
                                    : [],
                        }))
                    : [];

                updates.lead.contactPersonInfo = formattedContactPersonInfo;
            }

            // ────────────────────────────────────────────────
            // 🔧 NORMALIZE LEAD.SOURCE
            // ────────────────────────────────────────────────
            if (updates.lead && updates.lead.source !== undefined) {
                markChanged(`lead.source`);
                const src = updates.lead.source;

                const formattedSources = Array.isArray(src)
                    ? src
                        .filter((s) => s && (s.sourceName || s.reference))
                        .map((s) => ({
                            sourceName: s.sourceName?.trim() || "",
                            reference: s.reference?.trim() || "",
                        }))
                    : [];

                updates.lead.source = formattedSources;
            }

            // ────────────────────────────────────────────────
            // 🔒 DUPLICATE LEAD NAME VALIDATION
            // ────────────────────────────────────────────────
            if (updates.lead && updates.lead.name) {
                const newName = updates.lead.name.trim();

                const duplicateName = await leadOrder.findOne({
                    _id: { $ne: lead._id },
                    "lead.name": { $regex: new RegExp(`^${newName}$`, "i") },
                });

                if (duplicateName) {
                    return res.status(400).json({
                        success: false,
                        message: `A lead with the company name "${newName}" already exists.`,
                    });
                }
            }

            // ────────────────────────────────────────────────
            // 🔒 DUPLICATE GST VALIDATION
            // ────────────────────────────────────────────────
            if (updates.lead && updates.lead.firmCompanyGST) {
                const newGST = updates.lead.firmCompanyGST.trim().toUpperCase();

                const duplicateGST = await leadOrder.findOne({
                    _id: { $ne: lead._id },
                    $expr: {
                        $eq: [
                            { $toUpper: "$lead.firmCompanyGST" },
                            newGST
                        ]
                    }
                });

                if (duplicateGST) {
                    return res.status(400).json({
                        success: false,
                        message: `A lead with GST number "${newGST}" already exists.`,
                    });
                }
            }

            // ────────────────────────────────────────────────
            // 📁 HANDLE FILE UPLOADS (MULTER → S3)
            // ────────────────────────────────────────────────
            if (req.files && Object.keys(req.files).length) {
                for (const field of Object.keys(req.files)) {
                    const uploadedFiles = [];
                    for (const file of req.files[field]) {
                        const result = await uploadToS3(file.buffer, file.originalname, file.mimetype);
                        uploadedFiles.push(result.Location); // FULL S3 URL
                    }

                    switch (field) {
                        // Lead single-file fields
                        case 'aadharFile':
                        case 'firmCompanyGstFile':
                        case 'panFile':
                        case 'authLetterFile':
                        case 'contactPersonAadharFile':
                        case 'contactPersonPanFile':
                            markChanged(`lead.${field}`);
                            lead.lead = lead.lead || {};
                            lead.lead[field] = uploadedFiles[0];
                            lead.markModified('lead');
                            break;

                        case 'orderDocuments':
                            markChanged('order');
                            markChanged('order.documents');
                            updates['order'] = deepMerge(
                                updates['order'] || lead.order || {},
                                { documents: [...(lead.order?.documents || []), ...uploadedFiles] }
                            );
                            break;

                        case 'dispatchDocuments':
                            markChanged('dispatch');
                            markChanged('dispatch.documents');
                            updates['dispatch'] = deepMerge(
                                updates['dispatch'] || lead.dispatch || {},
                                { documents: [...(lead.dispatch?.documents || []), ...uploadedFiles] }
                            );
                            break;

                        case 'returnDocuments':
                            markChanged('return');
                            markChanged('return.documents');
                            updates['return'] = deepMerge(
                                updates['return'] || lead.return || {},
                                { documents: [...(lead.return?.documents || []), ...uploadedFiles] }
                            );
                            break;

                        case 'billingFiles':
                            markChanged('billing');
                            markChanged('billing.billFiles');
                            updates['billing'] = deepMerge(
                                updates['billing'] || lead.billing || {},
                                { billFiles: [...(lead.billing?.billFiles || []), ...uploadedFiles] }
                            );
                            break;

                        case 'billingDataFiles': {
                            markChanged('billing');
                            markChanged('billing.billingData');
                            if (!lead.billing) lead.billing = {};
                            if (!Array.isArray(lead.billing.billingData)) lead.billing.billingData = [];

                            let billNumber = null;
                            let amount = 0;

                            if (req.body.billing) {
                                try {
                                    const parsedBilling = typeof req.body.billing === "string"
                                        ? JSON.parse(req.body.billing)
                                        : req.body.billing;

                                    if (parsedBilling.billingData && Array.isArray(parsedBilling.billingData) && parsedBilling.billingData.length > 0) {
                                        const firstEntry = parsedBilling.billingData[0];
                                        billNumber = firstEntry.billNumber?.trim() || null;
                                        amount = firstEntry.amount ? Number(firstEntry.amount) : 0;
                                    }
                                } catch (err) {
                                    console.error("❌ Failed to parse billing JSON:", err);
                                }
                            }

                            const billingDataArray = JSON.parse(JSON.stringify(lead.billing.billingData));
                            const existingIndex = billNumber
                                ? billingDataArray.findIndex(b => b.billNumber === billNumber)
                                : -1;

                            if (existingIndex !== -1) {
                                const existing = billingDataArray[existingIndex];
                                const mergedFiles = [
                                    ...(Array.isArray(existing.billFiles) ? existing.billFiles : []),
                                    ...uploadedFiles,
                                ];

                                billingDataArray[existingIndex] = {
                                    ...existing,
                                    amount: amount || existing.amount || 0,
                                    billFiles: mergedFiles,
                                };
                            } else {
                                billingDataArray.push({
                                    billNumber: billNumber || `BILL-${Date.now()}`,
                                    amount,
                                    billFiles: uploadedFiles,
                                    followUps: [],
                                });
                            }

                            lead.billing.billingData = billingDataArray;
                            lead.markModified("billing.billingData");
                            break;
                        }

                        case 'paymentDataFiles': {
                            markChanged('payment');
                            markChanged('payment.paymentData');
                            if (!lead.payment) lead.payment = {};
                            if (!Array.isArray(lead.payment.paymentData)) lead.payment.paymentData = [];

                            const newPaymentData = {
                                status: req.body.status || "Pending",
                                amountPaid: req.body.amountPaid ? Number(req.body.amountPaid) : 0,
                                dueDate: req.body.dueDate ? new Date(req.body.dueDate) : new Date(),
                                followUps: [],
                            };

                            lead.payment.paymentData.push(newPaymentData);
                            lead.markModified("payment.paymentData");
                            break;
                        }

                        case 'aggrementDocument':
                            markChanged('aggrementDocument');
                            markChanged('aggrementDocument.documents');
                            updates['aggrementDocument'] = deepMerge(
                                updates['aggrementDocument'] || lead.aggrementDocument || {},
                                { documents: [...(lead.aggrementDocument?.documents || []), ...uploadedFiles] }
                            );
                            break;

                        case 'securityDocument':
                            markChanged('securityDocument');
                            markChanged('securityDocument.documents');
                            updates['securityDocument'] = deepMerge(
                                updates['securityDocument'] || lead.securityDocument || {},
                                { documents: [...(lead.securityDocument?.documents || []), ...uploadedFiles] }
                            );
                            break;

                        case 'leadFollowUpsDocuments': {
                            markChanged('leadFollowUps');
                            const cloned = lead.leadFollowUps ? [...lead.leadFollowUps] : [];
                            if (cloned.length === 0) {
                                cloned.push({
                                    user: userId,
                                    documents: uploadedFiles,
                                    note: '',
                                    nextFollowUpDate: null,
                                    createdAt: new Date()
                                });
                            } else {
                                const lastIdx = cloned.length - 1;
                                const prevDocs = cloned[lastIdx].documents || [];
                                cloned[lastIdx] = { ...cloned[lastIdx], documents: [...prevDocs, ...uploadedFiles] };
                            }
                            lead.leadFollowUps = cloned;
                            lead.markModified('leadFollowUps');
                            break;
                        }

                        case 'orderDataDocuments': {
                            markChanged('order');
                            markChanged('order.orderData');
                            if (!lead.order) lead.order = {};
                            if (!Array.isArray(lead.order.orderData)) lead.order.orderData = [];

                            let orderId = null;
                            let createdDate = new Date();

                            if (req.body.order) {
                                try {
                                    const parsedOrder = typeof req.body.order === "string"
                                        ? JSON.parse(req.body.order)
                                        : req.body.order;

                                    if (parsedOrder.orderData && Array.isArray(parsedOrder.orderData) && parsedOrder.orderData.length > 0) {
                                        orderId = parsedOrder.orderData[0].orderId || null;
                                        if (parsedOrder.orderData[0].createdDate) {
                                            createdDate = new Date(parsedOrder.orderData[0].createdDate);
                                        }
                                    } else if (parsedOrder.orderId) {
                                        orderId = parsedOrder.orderId;
                                        if (parsedOrder.createdDate) {
                                            createdDate = new Date(parsedOrder.createdDate);
                                        }
                                    }
                                } catch (err) {
                                    console.error("Failed to parse req.body.order:", err);
                                }
                            }

                            const orderDataArray = JSON.parse(JSON.stringify(lead.order.orderData));

                            if (orderId) {
                                const index = orderDataArray.findIndex((d) => d.orderId === orderId);

                                if (index !== -1) {
                                    const existingDocs = Array.isArray(orderDataArray[index].documents)
                                        ? orderDataArray[index].documents
                                        : [];
                                    orderDataArray[index].documents = [...existingDocs, ...uploadedFiles];
                                } else {
                                    orderDataArray.push({
                                        orderId,
                                        createdDate,
                                        documents: uploadedFiles,
                                    });
                                }
                            } else {
                                orderDataArray.push({
                                    orderId: `ORD-${Date.now()}`,
                                    createdDate,
                                    documents: uploadedFiles,
                                });
                            }

                            lead.order.orderData = orderDataArray;
                            lead.markModified('order.orderData');
                            lead.markModified('order');
                            delete updates.order;
                            break;
                        }

                        case 'dispatchDataDocuments': {
                            markChanged('dispatch');
                            markChanged('dispatch.dispatchData');
                            if (!lead.dispatch) lead.dispatch = {};
                            if (!Array.isArray(lead.dispatch.dispatchData)) lead.dispatch.dispatchData = [];

                            let mrnNumber = null;
                            let dispatchDate = new Date();

                            if (req.body.dispatch) {
                                try {
                                    const parsedDispatch = typeof req.body.dispatch === "string"
                                        ? JSON.parse(req.body.dispatch)
                                        : req.body.dispatch;

                                    if (parsedDispatch.dispatchData && Array.isArray(parsedDispatch.dispatchData) && parsedDispatch.dispatchData.length > 0) {
                                        mrnNumber = parsedDispatch.dispatchData[0].mrnNumber || null;
                                        if (parsedDispatch.dispatchData[0].dispatchDate) {
                                            dispatchDate = new Date(parsedDispatch.dispatchData[0].dispatchDate);
                                        }
                                    } else if (parsedDispatch.mrnNumber) {
                                        mrnNumber = parsedDispatch.mrnNumber;
                                        if (parsedDispatch.dispatchDate) {
                                            dispatchDate = new Date(parsedDispatch.dispatchDate);
                                        }
                                    }
                                } catch (err) {
                                    console.error("Failed to parse req.body.dispatch:", err);
                                }
                            }

                            const dispatchDataArray = JSON.parse(JSON.stringify(lead.dispatch.dispatchData));

                            if (mrnNumber) {
                                const index = dispatchDataArray.findIndex((d) => d.mrnNumber === mrnNumber);

                                if (index !== -1) {
                                    const existingDocs = Array.isArray(dispatchDataArray[index].documents)
                                        ? dispatchDataArray[index].documents
                                        : [];
                                    dispatchDataArray[index].documents = [...existingDocs, ...uploadedFiles];
                                } else {
                                    dispatchDataArray.push({
                                        mrnNumber,
                                        dispatchDate,
                                        documents: uploadedFiles,
                                    });
                                }
                            } else {
                                dispatchDataArray.push({
                                    mrnNumber: `MRN-${Date.now()}`,
                                    dispatchDate,
                                    documents: uploadedFiles,
                                });
                            }

                            lead.dispatch.dispatchData = dispatchDataArray;
                            lead.markModified('dispatch.dispatchData');
                            lead.markModified('dispatch');
                            delete updates.dispatch;
                            break;
                        }

                        case 'returnDataDocuments': {
                            markChanged('return');
                            markChanged('return.returnData');
                            if (!lead.return) lead.return = {};
                            if (!Array.isArray(lead.return.returnData)) lead.return.returnData = [];

                            let returnNumber = null;
                            let returnDate = new Date();

                            if (req.body.return) {
                                try {
                                    const parsedReturn = typeof req.body.return === "string"
                                        ? JSON.parse(req.body.return)
                                        : req.body.return;

                                    if (parsedReturn.returnData && Array.isArray(parsedReturn.returnData) && parsedReturn.returnData.length > 0) {
                                        returnNumber = parsedReturn.returnData[0].returnNumber || null;
                                        if (parsedReturn.returnData[0].returnDate) {
                                            returnDate = new Date(parsedReturn.returnData[0].returnDate);
                                        }
                                    } else if (parsedReturn.returnNumber) {
                                        returnNumber = parsedReturn.returnNumber;
                                        if (parsedReturn.returnDate) {
                                            returnDate = new Date(parsedReturn.returnDate);
                                        }
                                    }
                                } catch (err) {
                                    console.error("Failed to parse req.body.return:", err);
                                }
                            }

                            const returnDataArray = JSON.parse(JSON.stringify(lead.return.returnData));

                            if (returnNumber) {
                                const index = returnDataArray.findIndex((d) => d.returnNumber === returnNumber);

                                if (index !== -1) {
                                    const existingDocs = Array.isArray(returnDataArray[index].documents)
                                        ? returnDataArray[index].documents
                                        : [];
                                    returnDataArray[index].documents = [...existingDocs, ...uploadedFiles];
                                } else {
                                    returnDataArray.push({
                                        returnNumber,
                                        returnDate,
                                        documents: uploadedFiles,
                                    });
                                }
                            } else {
                                returnDataArray.push({
                                    returnNumber: `RETURN-${Date.now()}`,
                                    returnDate,
                                    documents: uploadedFiles,
                                });
                            }

                            lead.return.returnData = returnDataArray;
                            lead.markModified('return.returnData');
                            lead.markModified('return');
                            delete updates.return;
                            break;
                        }
                    }
                }
            }

            // ────────────────────────────────────────────────
            // 🔀 APPLY UPDATES VIA DEEP MERGE
            // ────────────────────────────────────────────────
            for (const key of Object.keys(updates)) {
                markChanged(key);
                const newVal = updates[key];
                if (isObject(newVal) && isObject(lead[key])) {
                    lead[key] = deepMerge(lead[key], newVal);
                } else {
                    lead[key] = newVal;
                }
                if (Array.isArray(lead[key])) {
                    lead.markModified(key);
                }
            }

            // ────────────────────────────────────────────────
            // 💾 SAVE DOCUMENT
            // ────────────────────────────────────────────────
            await lead.save();

            // ────────────────────────────────────────────────
            // 📸 FINAL SNAPSHOT AFTER SAVE
            // ────────────────────────────────────────────────
            const updatedLead = await leadOrder
                .findById(id)
                .lean();

            // ────────────────────────────────────────────────
            // 🕒 BUILD TIMELINE WITH FULL OBJECTS
            // ────────────────────────────────────────────────

            // Normalize values for accurate diff comparison
            const normalizeForDiff = (val) => {

                if (val === undefined) return undefined;
                if (val === null) return null;

                // Convert ObjectId → string
                if (val?.toString && val?._bsontype === "ObjectId") {
                    return val.toString();
                }

                // Convert Dates
                if (val instanceof Date) {
                    return val.toISOString();
                }

                if (Array.isArray(val)) {
                    return val.map(normalizeForDiff);
                }

                if (typeof val === "object") {
                    const normalized = {};
                    for (const key in val) {

                        // Ignore noisy Mongo fields if desired
                        if (key === "_id") {
                            normalized[key] = val[key]?.toString?.() || val[key];
                            continue;
                        }

                        normalized[key] = normalizeForDiff(val[key]);
                    }
                    return normalized;
                }

                return val;
            };


            const safeStringify = (val) => {
                const normalized = normalizeForDiff(val);
                if (normalized === undefined) return "undefined";
                if (normalized === null) return "null";
                if (typeof normalized === "object") {
                    try {
                        return JSON.stringify(normalized);
                    } catch {
                        return String(val);
                    }
                }
                return String(normalized);
            };

            const getNested = (obj, path) => {
                const result = path.split('.').reduce((acc, key) => {
                    if (!acc || typeof acc !== "object") return null;
                    return acc[key];
                }, obj);
                return result;
            };

            const getParentPath = (path) => {
                return path.split('.')[0];
            };


            let sectionsToCheck = changedSections.size > 0
                ? [...changedSections]
                : Object.keys(updates);

            // ✅ Convert everything to parent
            sectionsToCheck = [
                ...new Set(
                    sectionsToCheck.map(getParentPath)
                )
            ];


            const timelineChanges = [];
            sectionsToCheck.forEach((path) => {
                const before = getNested(originalLead, path);
                const after = getNested(updatedLead, path);

                // ✅ CRITICAL FIX: Skip if values are actually identical
                const beforeStr = safeStringify(before);
                const afterStr = safeStringify(after);

                if (beforeStr !== afterStr) {
                    timelineChanges.push({
                        field: path,
                        oldValue: beforeStr,
                        newValue: afterStr,
                    });
                }
            });

            // ────────────────────────────────────────────────
            // 💾 SAVE TIMELINE IF CHANGES DETECTED
            // ────────────────────────────────────────────────
            if (timelineChanges.length > 0) {
                // Re-fetch to ensure we have latest document with all saves applied
                const leadDocument = await leadOrder.findById(id);
                if (!Array.isArray(leadDocument.timeline)) leadDocument.timeline = [];
                leadDocument.timeline.push({
                    user: userId,
                    changes: timelineChanges,
                    updatedAt: new Date(),
                });
                await leadDocument.save();

                // Return fresh data with timeline
                const finalData = await leadOrder.findById(id).lean();
                return res.status(200).json({ success: true, message: 'Lead updated successfully', data: finalData });
            }

            return res.status(200).json({ success: true, message: 'Lead updated successfully', data: updatedLead });
        } catch (error) {
            console.error('Error updating lead:', error);
            return res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
        }
    },

    // Update Quotation of lead for Rent
    async updateLeadQuotation(req, res) {
        try {
            const userId = req.user._id; // From auth middleware
            const { leadId, quotationId } = req.query;

            // Find user
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // Validate and find lead
            const lead = await leadOrder.findById(leadId);
            if (!lead)
                return res.status(404).json({ success: false, message: "Lead not found" });

            // Prepare quotation data
            const data = {
                clientName: req.body.clientName || lead.lead.name,
                siteName: req.body.siteName || lead.lead.siteAddress,
                date: new Date().toISOString(),
                items: req.body.items || [],
                gstPercentage: req.body.gstPercentage || 18,
                daysRsInAdvance: req.body.daysRsInAdvance,
                termsAndConditions: req.body.termsAndConditions || [],
                uM: req.body.uM || "",
                type: "Rent"
            };

            // Convert days to text format
            const totalDaysAdvance = data.daysRsInAdvance || 0;
            const daysAdvanceText = convertDaysToMonthsDays(totalDaysAdvance);

            // Validate and map items
            const mappedItems = data.items.map((item) => ({
                item: item.item || "",
                size: item.size || "",
                quantity: item.quantity || 0,
                unit: item.unit || "",
                uM: item.uM || "",
                rentRatePerPiecePerDay: item.rentRatePerPiecePerDay || 0,
                rsInAdvance: item.rsInAdvance || 0,
                totalBeforeGST: item.quantity * item.rentRatePerPiecePerDay * 60 || 0,
                gstPercentage: data.gstPercentage,
                gstAmount:
                    (item.quantity * item.rentRatePerPiecePerDay * 60 * data.gstPercentage) /
                    100 || 0,
                totalAfterGST:
                    item.quantity *
                    item.rentRatePerPiecePerDay *
                    60 *
                    (1 + data.gstPercentage / 100) || 0,
            }));

            // Calculate totals
            const totalBeforeGST = req.body.grandTotalBeforeGST;
            const totalGST = req.body.grandGSTAmount;
            const totalAfterGST = req.body.grandTotalAfterGST;

            // Generate quotation HTML
            const htmlContent = generateQuotationTemplate({
                ...data,
                items: mappedItems,
                totalBeforeGST,
                totalGST,
                totalAfterGST,
                daysRsInAdvanceText: daysAdvanceText,
                daysRsInAdvanceDays: totalDaysAdvance,
                termsAndConditions: data.termsAndConditions,
                uM: data.uM,
            });

            // Convert HTML to PDF
            const pdfBuffer = await html_to_pdf.generatePdf(
                { content: htmlContent },
                { format: "A4" }
            );

            // Upload PDF to S3
            const fileName = `quotation_${leadId}_${Date.now()}.pdf`;
            const pdfFile = await uploadToS3(pdfBuffer, fileName, "application/pdf");
            const pdfUrl = pdfFile.Location;

            // Get next global quotation file number
            const { start: fileNumber } = await getNextSequence("quotationFileNumber", 1);
            const newFileEntry = { fileUrl: pdfUrl, fileNumber };

            // Ensure quotation is an array
            if (!Array.isArray(lead.quotation)) {
                lead.quotation = [];
            }

            // ✅ Case 1: Create new quotation
            if (quotationId === "new") {
                const newQuotation = {
                    _id: new mongoose.Types.ObjectId(),
                    sentDate: data.date,
                    items: mappedItems,
                    quotationFiles: [newFileEntry],
                    gstPercentage: data.gstPercentage,
                    grandTotalBeforeGST: totalBeforeGST,
                    grandGSTAmount: totalGST,
                    grandTotalAfterGST: totalAfterGST,
                    daysRsInAdvance: totalDaysAdvance,
                    termsAndConditions: data.termsAndConditions.map((t) => t.trim()),
                    type: data.type,
                };

                let previousFiles = [];

                if (Array.isArray(lead.quotation) && lead.quotation.length > 0) {

                    previousFiles = lead.quotation.flatMap(q =>
                        Array.isArray(q.quotationFiles) ? q.quotationFiles : []
                    );
                }


                lead.quotation.push(newQuotation);

                lead.markModified("quotation");

                lead.timeline.push({
                    user: userId,
                    changes: [
                        {
                            field: "quotation",
                            oldValue: previousFiles.length > 0
                                ? JSON.stringify({
                                    action: "Previous Files",
                                    files: previousFiles.map(f => ({
                                        fileUrl: f.fileUrl,
                                        fileNumber: f.fileNumber,
                                    })),
                                })
                                : "",
                            newValue: JSON.stringify({
                                action: "New Rent Quotation Created",
                                fileUrl: pdfUrl,
                                fileNumber: newFileEntry.fileNumber,
                            }),
                        },
                    ],
                    updatedAt: new Date(),
                });

                lead.markModified("timeline");
                await lead.save();

                return res.status(200).json({
                    success: true,
                    message: "New rent quotation created successfully",
                    pdfUrl,
                    pdfNumber: newFileEntry.fileNumber,
                    lead: lead._id,
                });
            }

            let previousFile = null;



            // ✅ Case 2: Update existing quotation
            const existingQuotation = lead.quotation.find(
                (q) => q._id.toString() === quotationId
            );

            if (!existingQuotation) {
                return res
                    .status(404)
                    .json({ success: false, message: "Quotation not found on this lead" });
            }

            if (
                Array.isArray(existingQuotation.quotationFiles) &&
                existingQuotation.quotationFiles.length > 0
            ) {
                previousFile = existingQuotation.quotationFiles[0];
            }

            // Update fields
            existingQuotation.sentDate = data.date;
            existingQuotation.items = mappedItems;
            existingQuotation.quotationFiles = Array.isArray(
                existingQuotation.quotationFiles
            )
                ? [newFileEntry, ...existingQuotation.quotationFiles]
                : [newFileEntry];

            existingQuotation.gstPercentage = data.gstPercentage;
            existingQuotation.grandTotalBeforeGST = totalBeforeGST;
            existingQuotation.grandGSTAmount = totalGST;
            existingQuotation.grandTotalAfterGST = totalAfterGST;
            existingQuotation.daysRsInAdvance = totalDaysAdvance;
            existingQuotation.updatedAt = new Date(),
                existingQuotation.termsAndConditions = data.termsAndConditions.map((t) =>
                    t.trim()
                );
            existingQuotation.type = data.type;

            lead.markModified("quotation");

            // Add timeline entry
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "quotation",
                        oldValue: previousFile
                            ? JSON.stringify({
                                action: "Previous File",
                                fileUrl: previousFile.fileUrl,
                                fileNumber: previousFile.fileNumber,
                            })
                            : "",
                        newValue: JSON.stringify({
                            action: "Rent Quotation File Updated",
                            fileUrl: pdfUrl,
                            fileNumber: newFileEntry.fileNumber,
                        }),
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Rent Quotation updated successfully",
                pdfUrl,
                pdfNumber: newFileEntry.fileNumber,
                lead: lead._id,
            });
        } catch (error) {
            console.error("Error generating PDF:", error);
            return res
                .status(500)
                .json({ success: false, message: "Failed to generate PDF" });
        }
    },

    // Update Quotation of lead for Sale
    async updateLeadQuotationSale(req, res) {
        try {
            const userId = req.user._id; // From auth middleware
            const { leadId, quotationId } = req.query;

            // Find user
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // Validate and find lead
            const lead = await leadOrder.findById(leadId);
            if (!lead)
                return res.status(404).json({ success: false, message: "Lead not found" });

            // Prepare quotation data
            const data = {
                clientName: req.body.clientName || lead.lead.name,
                siteName: req.body.siteName || lead.lead.siteAddress,
                date: new Date().toISOString(),
                items: req.body.items || [],
                gstPercentage: req.body.gstPercentage || 18,
                daysRsInAdvance: req.body.daysRsInAdvance,
                termsAndConditions: req.body.termsAndConditions || [],
                uM: req.body.uM || "",
                type: "Sale",
            };

            // Convert days to text format
            const totalDaysAdvance = data.daysRsInAdvance || 0;
            const daysAdvanceText = convertDaysToMonthsDays(totalDaysAdvance);

            // Validate and map items
            const mappedItems = data.items.map((item) => ({
                item: item.item || "",
                size: item.size || "",
                quantity: item.quantity || 0,
                unit: item.unit || "",
                uom: item.uom || "",
                amount: item.amount || 0,
                weight: item.weight || 0,
                rate: item.rate || 0,
                rentRatePerPiecePerDay: item.rentRatePerPiecePerDay || 0,
                rsInAdvance: item.rsInAdvance || 0,
                totalBeforeGST: item.quantity * item.rentRatePerPiecePerDay * 60 || 0,
                gstPercentage: data.gstPercentage,
                gstAmount:
                    (item.quantity * item.rentRatePerPiecePerDay * 60 * data.gstPercentage) /
                    100 || 0,
                totalAfterGST:
                    item.quantity *
                    item.rentRatePerPiecePerDay *
                    60 *
                    (1 + data.gstPercentage / 100) || 0,
                type: data.type,
            }));

            // Calculate totals
            const totalBeforeGST = req.body.grandTotalBeforeGST;
            const totalGST = req.body.grandGSTAmount;
            const totalAfterGST = req.body.grandTotalAfterGST;

            const loadingCharges = req.body.loadingCharges;
            const freitCharges = req.body.freitCharges;

            // Generate quotation HTML
            const htmlContent = generateSaleQuotationTemplate({
                ...data,
                items: mappedItems,
                totalBeforeGST,
                totalGST,
                totalAfterGST,
                daysRsInAdvanceText: daysAdvanceText,
                daysRsInAdvanceDays: totalDaysAdvance,
                termsAndConditions: data.termsAndConditions,
                uM: data.uM,
                loadingCharges,
                freitCharges,
            });

            // Convert HTML to PDF
            const pdfBuffer = await html_to_pdf.generatePdf(
                { content: htmlContent },
                { format: "A4" }
            );

            // Upload PDF to S3
            const fileName = `quotation_${leadId}_${Date.now()}.pdf`;
            const pdfFile = await uploadToS3(pdfBuffer, fileName, "application/pdf");
            const pdfUrl = pdfFile.Location;

            // Get next global quotation file number
            const { start: fileNumber } = await getNextSequence("quotationFileNumber", 1);
            const newFileEntry = { fileUrl: pdfUrl, fileNumber };

            // Ensure quotation is an array
            if (!Array.isArray(lead.quotation)) {
                lead.quotation = [];
            }

            // ✅ Case 1: Create new quotation
            if (quotationId === "new") {
                const newQuotation = {
                    _id: new mongoose.Types.ObjectId(),
                    sentDate: data.date,
                    items: mappedItems,
                    quotationFiles: [newFileEntry],
                    gstPercentage: data.gstPercentage,
                    grandTotalBeforeGST: totalBeforeGST,
                    grandGSTAmount: totalGST,
                    grandTotalAfterGST: totalAfterGST,
                    daysRsInAdvance: totalDaysAdvance,
                    termsAndConditions: data.termsAndConditions.map((t) => t.trim()),
                    type: data.type,
                    loadingCharges,
                    freitCharges,
                };

                let previousFiles = [];

                if (Array.isArray(lead.quotation) && lead.quotation.length > 0) {

                    previousFiles = lead.quotation.flatMap(q =>
                        Array.isArray(q.quotationFiles) ? q.quotationFiles : []
                    );
                }


                lead.quotation.push(newQuotation);
                lead.markModified("quotation")
                lead.timeline.push({
                    user: userId,
                    changes: [
                        {
                            field: "quotation",
                            oldValue: previousFiles.length > 0
                                ? JSON.stringify({
                                    action: "Previous Files",
                                    files: previousFiles.map(f => ({
                                        fileUrl: f.fileUrl,
                                        fileNumber: f.fileNumber,
                                    })),
                                })
                                : "",
                            newValue: JSON.stringify({
                                action: "New Sale Quotation Created",
                                fileUrl: pdfUrl,
                                fileNumber: newFileEntry.fileNumber,
                            }),
                        },
                    ],
                    updatedAt: new Date(),
                });
                lead.markModified("timeline")
                await lead.save();

                return res.status(200).json({
                    success: true,
                    message: "New Rent quotation created successfully",
                    pdfUrl,
                    pdfNumber: newFileEntry.fileNumber,
                    lead: lead._id,
                });
            }

            let previousFile = null;


            // ✅ Case 2: Update existing quotation
            const existingQuotation = lead.quotation.find(
                (q) => q._id.toString() === quotationId
            );

            if (!existingQuotation) {
                return res
                    .status(404)
                    .json({ success: false, message: "Quotation not found on this lead" });
            }
            if (
                Array.isArray(existingQuotation.quotationFiles) &&
                existingQuotation.quotationFiles.length > 0
            ) {
                previousFile = existingQuotation.quotationFiles[0];
            }
            // Update fields
            existingQuotation.sentDate = data.date;
            existingQuotation.items = mappedItems;
            existingQuotation.quotationFiles = Array.isArray(
                existingQuotation.quotationFiles
            )
                ? [newFileEntry, ...existingQuotation.quotationFiles]
                : [newFileEntry];

            existingQuotation.gstPercentage = data.gstPercentage;
            existingQuotation.grandTotalBeforeGST = totalBeforeGST;
            existingQuotation.grandGSTAmount = totalGST;
            existingQuotation.grandTotalAfterGST = totalAfterGST;
            existingQuotation.daysRsInAdvance = totalDaysAdvance;
            existingQuotation.updatedAt = new Date(),
                existingQuotation.termsAndConditions = data.termsAndConditions.map((t) =>
                    t.trim()
                );
            existingQuotation.type = data.type;
            existingQuotation.loadingCharges = loadingCharges;
            existingQuotation.freitCharges = freitCharges;
            // Add timeline entry
            lead.markModified("quotation");

            // Add timeline entry
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "quotation",
                        oldValue: previousFile
                            ? JSON.stringify({
                                action: "Previous File",
                                fileUrl: previousFile.fileUrl,
                                fileNumber: previousFile.fileNumber,
                            })
                            : "",
                        newValue: JSON.stringify({
                            action: "Sale Quotation File Updated",
                            fileUrl: pdfUrl,
                            fileNumber: newFileEntry.fileNumber,
                        }),
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Sale Quotation updated successfully",
                pdfUrl,
                pdfNumber: newFileEntry.fileNumber,
                lead: lead._id,
            });
        } catch (error) {
            console.error("Error generating PDF:", error);
            return res
                .status(500)
                .json({ success: false, message: "Failed to generate PDF" });
        }
    },

    // Create New Lead + Quotation in one go
    async createNewQuotation(req, res) {
        try {
            const userId = req.user._id; // From auth middleware

            // Find user for timeline
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // Extract data from body
            const {
                clientName,                    // This will become lead.name
                siteName,
                contactPersonName,
                contactPersonEmail,
                contactPersonPhone,
                enquiry,
                siteAddress,
                customerAddress,
                source,                        // optional array
                firmCompanyGST,
                // ... any other lead fields you want to accept

                items = [],                    // Quotation items
                gstPercentage = 18,
                daysRsInAdvance = 0,
                termsAndConditions = [],
                uM = "",
                grandTotalBeforeGST,
                grandGSTAmount,
                grandTotalAfterGST,
                note,
                followUpDate,
            } = req.body;
            const { quotationFollowUps = [] } = req.body;

            if (!clientName || !items.length) {
                return res.status(400).json({
                    success: false,
                    message: "clientName and at least one item are required",
                });
            }

            // 🚫 Prevent duplicate leads with same name
            const existingLead = await leadOrder.findOne({ "lead.name": { $regex: new RegExp(`^${clientName}$`, "i") } });
            if (existingLead) {
                return res.status(400).json({
                    success: false,
                    message: `A lead with the company name "${clientName}" already exists.`,
                });
            }

            // Convert days to readable format (e.g., "2 month(s) and 20 day(s)")
            const daysAdvanceText = convertDaysToMonthsDays(daysRsInAdvance);

            // Map and calculate quotation items
            const mappedItems = items.map((item) => {
                const subtotalBeforeGST = item.quantity * item.rentRatePerPiecePerDay * 60; // assuming 60 days base
                const gstAmount = (subtotalBeforeGST * gstPercentage) / 100;
                const totalAfterGST = subtotalBeforeGST + gstAmount;

                return {
                    item: item.item || "",
                    size: item.size || "",
                    quantity: item.quantity || 0,
                    unit: item.unit || "",
                    uM: item.uM || uM,
                    rentRatePerPiecePerDay: item.rentRatePerPiecePerDay || 0,
                    rsInAdvance: item.rsInAdvance || 0,
                    totalBeforeGST: subtotalBeforeGST,
                    gstPercentage,
                    gstAmount,
                    totalAfterGST,
                };
            });

            // Prepare data for PDF template
            const quotationDataForTemplate = {
                clientName,
                siteName: siteName || siteAddress || "",
                date: new Date().toISOString(),
                items: mappedItems,
                gstPercentage,
                daysRsInAdvanceText: daysAdvanceText,
                daysRsInAdvanceDays: daysRsInAdvance,
                termsAndConditions,
                uM,
                totalBeforeGST: grandTotalBeforeGST,
                totalGST: grandGSTAmount,
                totalAfterGST: grandTotalAfterGST,
            };

            // Generate HTML → PDF
            const htmlContent = generateQuotationTemplate(quotationDataForTemplate);
            const pdfBuffer = await html_to_pdf.generatePdf({ content: htmlContent }, { format: "A4" });

            // Upload to S3 with unique name
            const fileName = `quotation_new_${Date.now()}.pdf`;
            const pdfFile = await uploadToS3(pdfBuffer, fileName, "application/pdf");
            const pdfUrl = pdfFile.Location;

            const { start: fileNumber } = await getNextSequence("quotationFileNumber", 1);
            const pdfUrlEntry = { fileUrl: pdfUrl, fileNumber };


            // Create NEW LeadOrder document
            const newLead = new leadOrder({
                addedBy: userId,
                status: "Quotation Sent", // or "Lead Generated" → your choice, since quotation is sent immediately

                lead: {
                    name: clientName,
                    contactPersonName: contactPersonName || "",
                    contactPersonEmail: contactPersonEmail || "",
                    contactPersonPhone: contactPersonPhone || [],
                    enquiry: enquiry || "",
                    siteAddress: siteAddress || siteName || "",
                    customerAddress: customerAddress || "",
                    source: source || [],
                    firmCompanyGST: firmCompanyGST || "",
                    // ... other lead fields if provided
                },

                quotation: {
                    sentDate: new Date(),
                    items: mappedItems,
                    quotationFiles: [pdfUrlEntry], // first quotation PDF
                    gstPercentage,
                    grandTotalBeforeGST,
                    grandGSTAmount,
                    grandTotalAfterGST,
                    daysRsInAdvance: daysRsInAdvance,
                    termsAndConditions: termsAndConditions.map(t => t.trim()),
                    // Create a new follow-up object
                    followUps: quotationFollowUps.length > 0
                        ? quotationFollowUps.map(fup => ({
                            user: userId,
                            note: fup.note?.trim() || "",
                            followUpDate: fup.followUpDate ? new Date(fup.followUpDate) : null,
                            createdAt: new Date(),
                        })).filter(fup => fup.note) // only save if note exists
                        : [], // empty array if none
                },

                // Initial timeline entry
                timeline: [
                    {
                        user: userId,
                        changes: [
                            {
                                field: "lead",
                                oldValue: "",
                                newValue: JSON.stringify({
                                    action: "Lead Created",
                                    name: clientName,
                                }),
                            },

                            {
                                field: "quotation",
                                oldValue: "",
                                newValue: JSON.stringify({
                                    action: "Initial Quotation Created",
                                    fileUrl: pdfUrl,
                                    fileNumber: pdfUrlEntry.fileNumber,
                                }),
                            },

                            ...(quotationFollowUps.length > 0
                                ? [{
                                    field: "quotation",
                                    oldValue: "",
                                    newValue: JSON.stringify({
                                        action: "Quotation FollowUps Added",
                                        count: quotationFollowUps.length,
                                    }),
                                }]
                                : []),
                        ],

                        updatedAt: new Date(),
                    },
                ],
            });

            const savedLead = await newLead.save();
            // ✅ Push lead ID into user's addedLead array
            user.addedLead.push(savedLead._id);
            await user.save();

            return res.status(201).json({
                success: true,
                message: `New lead created with quotation file number ${pdfUrlEntry.fileNumber} successfully.`,
                leadId: newLead._id,
                pdfUrl,
                pdfNumber: pdfUrlEntry.fileNumber,
                lead: newLead,
            });

        } catch (error) {
            console.error("Error creating lead with quotation:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to create lead and quotation",
                error: error.message,
            });
        }
    },

    // Add a new quotation follow-up
    async updateLeadQuotationFollowUp(req, res) {
        try {
            const userId = req.user._id; // From auth middleware
            const { leadId, quotationId } = req.query;
            const { note, followUpDate } = req.body; // From request body

            // Validate required data
            if (!leadId || !quotationId) {
                return res.status(400).json({
                    success: false,
                    message: "Both 'leadId' and 'quotationId' are required in query.",
                });
            }

            if (!note || !followUpDate) {
                return res.status(400).json({
                    success: false,
                    message: "Both 'note' and 'followUpDate' are required.",
                });
            }

            // Validate user
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found",
                });
            }

            // Find lead
            const lead = await leadOrder.findById(leadId);
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found",
                });
            }

            // Ensure quotations exist
            if (!Array.isArray(lead.quotation) || lead.quotation.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "No quotations found for this lead.",
                });
            }

            // Find the specific quotation by ID
            const quotation = lead.quotation.find(
                (q) => q._id.toString() === quotationId
            );

            if (!quotation) {
                return res.status(404).json({
                    success: false,
                    message: "Quotation not found in this lead.",
                });
            }

            // Create a new follow-up object
            const newFollowUp = {
                user: userId,
                note,
                followUpDate: new Date(followUpDate),
                createdAt: new Date(),
            };

            // Ensure followUps array exists
            if (!Array.isArray(quotation.followUps)) {
                quotation.followUps = [];
            }

            let previousFollowUps = [];

            if (Array.isArray(quotation.followUps)) {
                previousFollowUps = quotation.followUps.map(f => ({
                    note: f.note,
                    followUpDate: f.followUpDate,
                    createdAt: f.createdAt,
                }));
            }

            // Add new follow-up
            quotation.followUps.push(newFollowUp);
            lead.markModified("quotation");

            let updatedFollowUps = quotation.followUps.map(f => ({
                note: f.note,
                followUpDate: f.followUpDate,
                createdAt: f.createdAt,
            }));


            // Add timeline entry
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "quotation",

                        oldValue: previousFollowUps.length > 0
                            ? JSON.stringify({
                                action: "Previous FollowUps",
                                followUps: previousFollowUps,
                            })
                            : "",

                        newValue: JSON.stringify({
                            action: "Quotation FollowUps Updated",
                            followUps: updatedFollowUps,
                        }),
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline")

            // Save the updated document
            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Quotation follow-up added successfully",
                data: newFollowUp,
            });
        } catch (error) {
            console.error("Error saving quotation follow-up:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to save quotation follow-up",
                error: error.message,
            });
        }
    },

    // Update Status of lead
    async updateStatus(req, res) {
        try {
            const userId = req.user._id;
            const { id } = req.params;
            const { status } = req.body;

            // ─────────────────────────────
            // Validate user
            // ─────────────────────────────
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found",
                });
            }

            // ─────────────────────────────
            // Validate status
            // ─────────────────────────────
            if (!status) {
                return res.status(400).json({
                    success: false,
                    message: "Status is required",
                });
            }

            // ─────────────────────────────
            // Fetch lead
            // ─────────────────────────────
            const lead = await leadOrder.findById(id);
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found",
                });
            }

            const oldStatus = lead.status || "";

            // Prevent duplicate timeline
            if (oldStatus === status) {
                return res.status(400).json({
                    success: false,
                    message: `Lead is already in status "${status}"`,
                });
            }

            // ─────────────────────────────
            // Update status
            // ─────────────────────────────
            lead.status = status;
            lead.markModified("status");

            // ─────────────────────────────
            // Timeline entry
            // ─────────────────────────────
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "status",

                        oldValue: JSON.stringify({
                            action: "Previous Status",
                            value: oldStatus,
                        }),

                        newValue: JSON.stringify({
                            action: "Status Updated",
                            value: status,
                        }),
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            // ─────────────────────────────
            // Save
            // ─────────────────────────────
            await lead.save();

            return res.status(200).json({
                success: true,
                message: `Lead status updated successfully: ${status}`,
                lead,
            });

        } catch (error) {
            console.error("Error updating lead status:", error);

            return res.status(500).json({
                success: false,
                message: "Internal Server Error",
                error: error.message,
            });
        }
    },

    // Update FollowUps Status
    async updateFollowUpStatus(req, res) {
        try {
            const { leadId } = req.params;
            const { section, followUpId, status } = req.body;

            // --- 1. Validate user ---
            const userId = req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized access" });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // --- 2. Validate required fields ---
            if (!leadId || !section || !followUpId || !status) {
                return res.status(400).json({
                    success: false,
                    message: "leadId, section, followUpId, and status are required",
                });
            }

            const validStatuses = ["Progress", "Pending", "Completed"];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: "Invalid status value" });
            }

            // --- 3. Find lead order ---
            const leadOrder = await leadOrder.findById(leadId);
            if (!leadOrder) {
                return res.status(404).json({ success: false, message: "LeadOrder not found" });
            }

            let updated = false;
            let oldStatus = "";
            let newStatus = status;

            // --- 4. Helper: update follow-up arrays ---
            const updateFollowUpArray = (arr) => {
                const followUp = arr.id(followUpId);
                if (followUp) {
                    oldStatus = followUp.status;
                    followUp.status = status;
                    updated = true;
                }
            };

            // --- 5. Identify correct section ---
            switch (section) {
                case "leadFollowUps":
                    updateFollowUpArray(leadOrder.leadFollowUps);
                    break;

                case "quotation":
                    leadOrder.quotation.forEach((q) => updateFollowUpArray(q.followUps));
                    break;

                case "billing":
                    if (leadOrder.billing) {
                        updateFollowUpArray(leadOrder.billing.followUps);
                        // if (leadOrder.billing.billingData) {
                        //     leadOrder.billing.billingData.forEach((b) => updateFollowUpArray(b.followUps));
                        // }
                    }
                    break;

                case "payment":
                    if (leadOrder.payment) {
                        updateFollowUpArray(leadOrder.payment.followUps);
                        // if (leadOrder.payment.paymentData) {
                        //     leadOrder.payment.paymentData.forEach((p) => updateFollowUpArray(p.followUps));
                        // }
                    }
                    break;

                case "legal":
                    if (leadOrder.legal) {
                        updateFollowUpArray(leadOrder.legal.followUps);
                    }
                    break;

                default:
                    return res.status(400).json({ success: false, message: "Invalid section name" });
            }

            if (!updated) {
                return res.status(404).json({ success: false, message: "Follow-up not found" });
            }

            // --- 6. Add timeline entry ---
            leadOrder.timeline.push({
                user: userId,
                changes: [
                    {
                        field: `${section} follow-up status`,
                        oldValue: oldStatus,
                        newValue: newStatus,
                    },
                ],
                updatedAt: new Date(),
            });

            // --- 7. Save and respond ---
            await leadOrder.save();

            return res.status(200).json({
                success: true,
                message: `Follow-up status updated successfully in ${section}`,
                leadOrder,
            });
        } catch (error) {
            console.error("Error updating follow-up status:", error);
            return res.status(500).json({
                success: false,
                message: "Internal Server Error",
                error: error.message,
            });
        }
    },

    // Get All Cases
    // async getAllLeads(req, res) {
    //     try {
    //         const userId = req.user?._id;
    //         if (!userId) {
    //             return res.status(401).json({ success: false, message: "Unauthorized access" });
    //         }

    //         const user = await User.findById(userId);
    //         if (!user) {
    //             return res.status(404).json({ success: false, message: "User not found" });
    //         }

    //         // Pagination inputs
    //         const page = Math.max(1, parseInt(req.query.page) || 1);
    //         const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    //         const skip = (page - 1) * limit;

    //         // Search functionality
    //         const search = req.query.search?.trim() || "";
    //         let searchFilter = {};

    //         if (search) {
    //             const isNumericSearch = !isNaN(search);

    //             searchFilter = {
    //                 $or: [
    //                     { "lead.name": { $regex: search, $options: "i" } },
    //                     { "lead.contactPersonName": { $regex: search, $options: "i" } },
    //                     { "lead.contactPersonEmail": { $regex: search, $options: "i" } },
    //                     ...(isNumericSearch ? [{ "lead.contactPersonPhone": Number(search) }] : []),
    //                     { "lead.enquiry": { $regex: search, $options: "i" } },
    //                     { "lead.siteAddress": { $regex: search, $options: "i" } },
    //                     { "lead.customerAddress": { $regex: search, $options: "i" } },
    //                     { "lead.firmCompanyGST": { $regex: search, $options: "i" } },
    //                     { "lead.aadharNumber": { $regex: search, $options: "i" } },
    //                     { "status": { $regex: search, $options: "i" } },
    //                 ],
    //             };
    //         }

    //         // Status filter logic
    //         let statusFilter = {};
    //         let excludeCustomers = {};

    //         if (req.query.status && req.query.status !== "all") {
    //             // Apply status filter if provided
    //             statusFilter = { status: req.query.status };
    //         } else {
    //             // By default, exclude certain statuses and isCustomer
    //             excludeCustomers = {
    //                 isCustomer: { $ne: true },
    //                 status: { $nin: ["Marked Defaulter", "Marked Discard", "Marked Complete", "Marked Legal"] }
    //             };
    //         }

    //         let addedByFilter = {};
    //         if (req.query.addedBy) {
    //             addedByFilter = { addedBy: req.query.addedBy };
    //         }

    //         // Combine filters
    //         const combinedFilter = { ...searchFilter, ...statusFilter, ...excludeCustomers, ...addedByFilter };

    //         const today = new Date();
    //         today.setHours(0, 0, 0, 0);

    //         const excludeLeadsWithFollowUps = {
    //             $or: [
    //                 { "leadFollowUps.nextFollowUpDate": { $gte: today } },
    //                 { "quotation.followUps.followUpDate": { $gte: today } },
    //                 { "billing.followUps.followUpDate": { $gte: today } },
    //             ],
    //         };

    //         const finalFilter = {
    //             ...combinedFilter,
    //             $nor: [excludeLeadsWithFollowUps],
    //         };


    //         // Total count for pagination and defaulters
    //         const [totalLeads, totalDefaulters, leads] = await Promise.all([
    //             leadOrder.countDocuments(finalFilter),
    //             leadOrder.countDocuments({ status: "Marked Defaulter" }),
    //             leadOrder.find(finalFilter)
    //                 .populate("addedBy", "name email")
    //                 .sort({ createdAt: -1 })
    //                 .skip(skip)
    //                 .limit(limit),
    //         ]);

    //         if (!leads.length) {
    //             return res.status(200).json({
    //                 success: true,
    //                 message: "No leads found",
    //                 totalLeads,
    //                 totalDefaulters,
    //                 page,
    //                 pages: 0,
    //                 data: []
    //             });
    //         }

    //         res.status(200).json({
    //             success: true,
    //             count: leads.length,
    //             data: leads,
    //             totalLeads,
    //             totalDefaulters,
    //             pagination: {
    //                 page,
    //                 limit,
    //                 totalPages: Math.ceil(totalLeads / limit),
    //             },
    //         });

    //     } catch (err) {
    //         console.error("Error in getAllLeads:", err);
    //         res.status(500).json({ success: false, message: "Internal server error" });
    //     }
    // },
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

            // 📄 Pagination
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
            const skip = (page - 1) * limit;

            // 🔍 Search Filter
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
                        { status: { $regex: search, $options: "i" } },
                    ],
                };
            }

            // ⚙️ Status Filter
            let statusFilter = {};
            let excludeCustomers = {};

            if (req.query.status && req.query.status !== "all") {

                excludeCustomers = {
                    isCustomer: { $ne: true },
                    status: { $eq: req.query.status },
                };
            } else {
                excludeCustomers = {
                    isCustomer: { $ne: true },
                    status: { $nin: ["Marked Defaulter", "Marked Discard", "Marked Complete", "Marked Legal"] },
                };
            }

            // 👤 AddedBy Filter
            let addedByFilter = {};
            if (req.query.addedBy) {
                addedByFilter = { addedBy: req.query.addedBy };
            }

            // 🧩 Combine Filters
            // ⚙️ Status Filter
            // let statusFilter = {};
            if (req.query.status && req.query.status !== "all") {
                statusFilter = { status: req.query.status };
            } else {
                statusFilter = {
                    status: {
                        $nin: ["Marked Defaulter", "Marked Discard", "Marked Complete", "Marked Legal"],
                    },
                };
            }

            // 👤 AddedBy Filter
            // const addedByFilter = req.query.addedBy ? { addedBy: req.query.addedBy } : {};

            // // 🚫 Exclude customers
            // const excludeCustomers = { isCustomer: { $ne: true } };

            // 🔒 Role-based access
            // const accessFilter =
            //     user.role?.toLowerCase() === "admin" ? {} : { addedBy: userId };

            // // 🚫 Exclude allotted leads
            // const excludeAllottedFilter = {
            //     $or: [
            //         { leadAllotedTo: { $exists: false } },
            //         { leadAllotedTo: { $size: 0 } },
            //     ],
            // };
            // 🔒 Role-based access
            let accessFilter = {};
            let allotmentFilter = {};

            // 🧠 Admins see all unalloted leads
            if (user.role?.toLowerCase() === "admin") {
                // 🧠 Admins see:
                // 1️⃣ Unalloted leads
                // 2️⃣ Alloted leads that are terminal (complete, discard, etc.)
                allotmentFilter = {
                    $or: [
                        // Unalloted leads
                        { leadAllotedTo: { $exists: false } },
                        { leadAllotedTo: { $size: 0 } },

                        // Alloted leads with terminal statuses
                        {
                            $and: [
                                { leadAllotedTo: { $exists: true, $ne: [] } },
                                { status: { $in: ["Marked Defaulter", "Marked Discard", "Marked Complete", "Marked Legal"] } },
                            ],
                        },
                    ],
                };
            } else {
                // Non-admins: see only leads alloted to them
                allotmentFilter = { "leadAllotedTo.user": userId.toString() };
            }



            // 🧩 Combine all filters safely inside `$and`
            const andFilters = [
                excludeCustomers,
                statusFilter,
                addedByFilter,
                accessFilter,
                // excludeAllottedFilter,
                allotmentFilter
            ];

            if (Object.keys(searchFilter).length) {
                andFilters.push(searchFilter); // ✅ preserve $or search conditions
            }

            // 🅰️ Alphabet Range Filter (A–F, G–L, etc.)
            // 🅰️ Alphabet Range Filter — based only on lead.name
            const alphaRange = req.query.alphaRange;
            if (alphaRange) {
                const [start, end] = alphaRange.split("-").map((ch) => ch.trim().toUpperCase());

                if (start && end) {
                    // Case-insensitive match for names starting in the given letter range
                    const alphaRegex = new RegExp(
                        `^[${start.toUpperCase()}-${end.toUpperCase()}${start.toLowerCase()}-${end.toLowerCase()}]`
                    );

                    andFilters.push({
                        "lead.name": { $regex: alphaRegex },
                    });
                } else if (alphaRange.toLowerCase() === "others") {
                    // Optional: match names not starting with a letter (e.g. 1, #, @)
                    andFilters.push({
                        "lead.name": { $regex: /^[^A-Za-z]/ },
                    });
                }
            }


            const finalFilter = { $and: andFilters };


            // 🕒 Exclude leads with future follow-ups
            // 🕒 Exclude leads that already have *today or future* follow-ups (shown in showFollowUps)
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const excludeLeadsWithFollowUps = {
                $or: [
                    // Lead Follow-ups
                    { leadFollowUps: { $elemMatch: { nextFollowUpDate: { $gte: today } } } },

                    // Quotation Follow-ups
                    { "quotation.followUps": { $elemMatch: { followUpDate: { $gte: today } } } },

                    // Billing Follow-ups
                    { "billing.followUps": { $elemMatch: { followUpDate: { $gte: today } } } },

                    // Payment Follow-ups
                    { "payment.followUps": { $elemMatch: { followUpDate: { $gte: today } } } },

                    // Legal Follow-ups
                    { "legal.followUps": { $elemMatch: { followUpDate: { $gte: today } } } },
                ],
            };

            // not showing the leads having follow-ups scheduled except the statuses which are terminal
            const effectiveFilter = {
                $and: [
                    ...andFilters,
                    {
                        $or: [
                            // 🟩 Leads with terminal statuses → DO NOT check follow-ups
                            { status: { $in: ["Marked Defaulter", "Marked Discard", "Marked Complete", "Marked Legal"] } },

                            // 🟨 All other leads → exclude if they have upcoming follow-ups
                            {
                                $and: [
                                    { status: { $nin: ["Marked Defaulter", "Marked Discard", "Marked Complete", "Marked Legal"] } },
                                    { $nor: excludeLeadsWithFollowUps.$or },
                                ],
                            },
                        ],
                    },
                ],
            };

            // not showing the leads having follow-ups scheduled
            // const effectiveFilter = {
            //     $and: [
            //         ...andFilters,
            //         { $nor: excludeLeadsWithFollowUps.$or } // exclude any lead having upcoming follow-ups
            //     ],
            // };

            // 📊 Fetch data
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
                    data: [],
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

    // Allotes/Assigned Lead
    async getLeadAllotedTo(req, res) {
        try {
            const userId = req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized access" });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // 📄 Pagination
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
            const skip = (page - 1) * limit;

            // 🔍 Search Filter
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
                        { status: { $regex: search, $options: "i" } },
                    ],
                };
            }

            // ⚙️ Status Filter
            let statusFilter = {};
            let excludeCustomers = {};

            if (req.query.status && req.query.status !== "all") {
                statusFilter = { status: req.query.status };
            } else {
                excludeCustomers = {
                    isCustomer: { $ne: true },
                    status: { $nin: ["Marked Defaulter", "Marked Discard", "Marked Complete", "Marked Legal"] },
                };
            }

            // 👤 AddedBy Filter (manual filter param)
            let addedByFilter = {};
            if (req.query.addedBy) {
                addedByFilter = { addedBy: req.query.addedBy };
            }

            // 🅰️ Alphabet Range Filter (case-insensitive, only from lead.name)
            const alphaRange = req.query.alphaRange;
            let alphaRangeFilter = {};

            if (alphaRange) {
                const [start, end] = alphaRange.split("-").map((ch) => ch.trim().toUpperCase());

                if (start && end) {
                    // Match A–F / a–f etc.
                    const alphaRegex = new RegExp(
                        `^[${start.toUpperCase()}-${end.toUpperCase()}${start.toLowerCase()}-${end.toLowerCase()}]`
                    );

                    alphaRangeFilter = {
                        "lead.name": { $regex: alphaRegex },
                    };
                } else if (alphaRange.toLowerCase() === "others") {
                    // Match non-alphabetic names (optional)
                    alphaRangeFilter = {
                        "lead.name": { $regex: /^[^A-Za-z]/ },
                    };
                }
            }

            // 🧩 Combine base filters
            const combinedFilter = { ...searchFilter, ...statusFilter, ...excludeCustomers, ...addedByFilter, ...alphaRangeFilter };

            // ✅ Base filter: show only leads that are allotted to someone
            const onlyAllottedLeadsFilter = {
                leadAllotedTo: { $exists: true, $ne: [] },
            };

            // 🧠 Access control logic
            let accessFilter = {};

            if (user.role === "Admin" || user.role === "admin") {
                // Admins see all allotted leads
                accessFilter = {};
            } else {
                // Non-admins: only leads they added OR are allotted to them
                accessFilter = {
                    $or: [
                        // { addedBy: userId },
                        { "leadAllotedTo.user": userId.toString() },
                    ],
                };
            }

            // 🧠 Combine all filters
            const finalFilter = {
                ...combinedFilter,
                ...onlyAllottedLeadsFilter,
                ...accessFilter,
            };

            // 📊 Fetch data
            const [totalLeads, totalDefaulters, leads] = await Promise.all([
                leadOrder.countDocuments(finalFilter),
                leadOrder.countDocuments({ status: "Marked Defaulter" }),
                leadOrder.find(finalFilter)
                    .populate("addedBy", "name email")
                    .select("lead leadAllotedTo addedBy status createdAt updatedAt")
                    .populate({
                        path: "leadAllotedTo.user", // 👈 populate the user inside the array
                        model: "User",
                        select: "name role", // 👈 only include required fields
                    })
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit),
            ]);

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
            console.error("Error in getLeadAllotedTo:", err);
            res.status(500).json({ success: false, message: "Internal server error" });
        }
    },

    // Get Case of User
    async getUserLead(req, res) {
        try {
            const userId = req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized access" });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(400).json({ success: false, message: "User not found" });
            }

            // Pagination inputs with validation
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
            const skip = (page - 1) * limit;

            // 🔍 Search functionality
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

            // 🧩 Combine user + search filters
            const combinedFilter = { addedBy: userId, ...searchFilter };

            // 🧮 Count and fetch
            const [totalLeads, leads] = await Promise.all([
                leadOrder.countDocuments(combinedFilter),
                leadOrder.find(combinedFilter)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
            ]);

            // 📄 Handle empty results
            if (!leads.length) {
                return res.status(200).json({
                    success: true,
                    message: "No leads found for this user",
                    total: 0,
                    page,
                    pages: 0,
                    data: [],
                });
            }

            // ✅ Successful response
            res.status(200).json({
                success: true,
                count: leads.length,
                data: leads,
                pagination: {
                    page,
                    limit,
                    totalPages: Math.ceil(totalLeads / limit),
                    totalLeads,
                },
            });

        } catch (err) {
            console.error("Error in getUserLead:", err);
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
                        // { addedBy: userId },
                        { "leadAllotedTo.user": userId.toString() } // ensure string match
                    ],
                };
            }


            let addedByFilter = {};
            if (req.query.addedBy) {
                addedByFilter = { addedBy: req.query.addedBy };
            }

            // 🅰️ Alphabet Range Filter (case-insensitive, only from lead.name)
            const alphaRange = req.query.alphaRange;
            let alphaRangeFilter = {};

            if (alphaRange) {
                const [start, end] = alphaRange.split("-").map((ch) => ch.trim().toUpperCase());

                if (start && end) {
                    // Build regex like /^[A-Fa-f]/ for case-insensitive range
                    const alphaRegex = new RegExp(
                        `^[${start.toUpperCase()}-${end.toUpperCase()}${start.toLowerCase()}-${end.toLowerCase()}]`
                    );

                    alphaRangeFilter = {
                        "lead.name": { $regex: alphaRegex },
                    };
                } else if (alphaRange.toLowerCase() === "others") {
                    // Match non-alphabetic names
                    alphaRangeFilter = {
                        "lead.name": { $regex: /^[^A-Za-z]/ },
                    };
                }
            }

            // Combine filters
            const combinedFilter = { ...searchFilter, ...statusFilter, ...customerFilter, ...visibilityFilter, ...addedByFilter, ...alphaRangeFilter };

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

    // Get Lead by ID
    async getLeadById(req, res) {
        try {
            const userId = req.user?._id;
            const { id } = req.params;

            if (!userId) {
                return res.status(401).json({ success: false, message: 'Unauthorized: User not found' });
            }

            if (!id) {
                return res.status(400).json({ success: false, message: 'Lead ID is required' });
            }

            const lead = await leadOrder.findById(id)
                .populate("addedBy", "name email phone role") // who created lead
                .populate("leadFollowUps.user", "name email") // follow-up user info
                .populate("quotation.followUps.user", "name email") // quotation follow-up user
                .populate("payment.followUps.user", "name email") // payment follow-up user
                .populate("billing.followUps.user", "name email") // payment follow-up user
                .populate("legal.followUps.user", "name email") // payment follow-up user
                .populate("timeline.user", "name email"); // timeline user

            if (!lead) {
                return res.status(400).json({ success: false, message: 'No lead found' });
            }

            // ✅ Sort leadFollowUps by createdAt descending
            if (lead.leadFollowUps && Array.isArray(lead.leadFollowUps)) {
                lead.leadFollowUps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }

            // ✅ Sort quotation.followUps by createdAt descending
            if (lead.quotation?.followUps && Array.isArray(lead.quotation.followUps)) {
                lead.quotation.followUps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }

            // ✅ Sort payment.followUps by createdAt descending
            if (lead.payment?.followUps && Array.isArray(lead.payment.followUps)) {
                lead.payment.followUps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }

            return res.status(200).json({
                success: true,
                message: "Lead retrieved successfully",
                lead
            });

        } catch (error) {
            console.error("Error getting lead:", error);
            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }
    },

    // Get Quotation by ID
    async getQuotationById(req, res) {
        try {
            const userId = req.user?._id;

            if (!userId) {
                return res.status(401).json({ success: false, message: 'Unauthorized: User not found' });
            }

            // Extract from query parameters
            const { leadId, quotationId } = req.query;

            if (!leadId) {
                return res.status(400).json({ success: false, message: 'Lead ID is required in query parameters' });
            }

            // Find the lead with all necessary population
            const lead = await leadOrder.findById(leadId)
                .populate("quotation.followUps.user", "name email")

            if (!lead) {
                return res.status(404).json({ success: false, message: 'Lead not found' });
            }

            // Handle multiple quotations: sort each quotation's followUps
            if (lead.quotation?.length) {
                lead.quotation.forEach(q => {
                    if (q.followUps?.length) {
                        q.followUps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                    }
                });
            }

            if (quotationId === "new") {
                return res.status(200).json({
                    success: true,
                    message: "Lead retrieved successfully",
                    leadId: lead._id,
                    leadName: lead.lead.name,
                    quotation: []
                });
            }

            // CASE 1: Both leadId and quotationId provided → return only specific quotation
            if (quotationId) {
                // Find the quotation by its _id (MongoDB ObjectId)
                const specificQuotation = lead.quotation.find(q => q._id.toString() === quotationId);

                if (!specificQuotation) {
                    return res.status(404).json({ success: false, message: 'Quotation not found in this lead' });
                }

                return res.status(200).json({
                    success: true,
                    message: "Specific quotation retrieved successfully",
                    leadId: lead._id,
                    leadName: lead.lead.name,
                    quotation: specificQuotation  // Return only this quotation object
                });
            }

            // CASE 2: Only leadId provided → return full lead details
            return res.status(200).json({
                success: true,
                message: "Lead retrieved successfully",
                leadId: lead._id,
                quotation: []
            });

        } catch (error) {
            console.error("Error in getQuotationById:", error);
            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }
    },

    // Delete Lead
    async deleteLead(req, res) {
        try {
            const userId = req.user._id; // from auth middleware
            const { id } = req.params

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const deletedLead = await leadOrder.findByIdAndDelete(id);

            if (!deletedLead) {
                return res.status(404).json({
                    success: false,
                    message: 'Lead not found',
                });
            }

            res.status(200).json({
                success: true,
                message: 'Lead deleted successfully',
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Server Error',
                error: error.message,
            });
        }
    },

    // Update Lead to Discard
    async updateLeadToDiscard(req, res) {
        try {
            const userId = req.user._id;
            const { id } = req.params;

            // ─────────────────────────────
            // Validate user
            // ─────────────────────────────
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found",
                });
            }

            // ─────────────────────────────
            // Fetch lead (NOT findByIdAndUpdate)
            // ─────────────────────────────
            const lead = await leadOrder.findById(id);
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found",
                });
            }

            // ─────────────────────────────
            // Capture OLD status
            // ─────────────────────────────
            const oldStatus = lead.status || "";

            // If already discarded → prevent duplicate timeline
            if (oldStatus === "Marked Discard") {
                return res.status(400).json({
                    success: false,
                    message: "Lead is already marked as discard",
                });
            }

            // ─────────────────────────────
            // Update status
            // ─────────────────────────────
            lead.status = "Marked Discard";
            lead.markModified("status");

            // ─────────────────────────────
            // Timeline entry
            // ─────────────────────────────
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "status",

                        oldValue: JSON.stringify({
                            action: "Previous Status",
                            value: oldStatus,
                        }),

                        newValue: JSON.stringify({
                            action: "Lead Marked As Discard",
                            value: "Marked Discard",
                        }),
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            // ─────────────────────────────
            // Save
            // ─────────────────────────────
            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Lead discarded successfully",
            });

        } catch (error) {
            console.error("Discard Lead Error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // Delete File
    async deleteFile(req, res) {
        try {
            const userId = req.user._id;
            const { id } = req.params; // leadId
            const { url, quotationId } = req.body;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    message: "leadId is required",
                });
            }

            // ─────────────────────────────
            // Find Lead
            // ─────────────────────────────
            const lead = await leadOrder.findById(id);

            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found",
                });
            }

            // ============================================================
            // ✅ CASE 1 → DELETE COMPLETE QUOTATION
            // ============================================================
            if (quotationId) {

                const quotationIndex = lead.quotation.findIndex(
                    (q) => q._id.toString() === quotationId
                );

                if (quotationIndex === -1) {
                    return res.status(404).json({
                        success: false,
                        message: "Quotation not found",
                    });
                }

                const quotationToDelete = lead.quotation[quotationIndex];

                // ─────────────────────────────
                // Snapshot OLD quotation
                // ─────────────────────────────
                const oldQuotationSnapshot = {
                    quotationFiles: quotationToDelete.quotationFiles || [],
                    followUps: quotationToDelete.followUps || [],
                    sentDate: quotationToDelete.sentDate || null,
                    type: quotationToDelete.type || "",
                };

                // ─────────────────────────────
                // (Optional) Delete all files from S3
                // ─────────────────────────────
                /*
                for (const file of quotationToDelete.quotationFiles || []) {
                    await deleteS3File(file.fileUrl);
                }
                */

                // ─────────────────────────────
                // Remove quotation
                // ─────────────────────────────
                lead.quotation.splice(quotationIndex, 1);

                lead.markModified("quotation");

                // ─────────────────────────────
                // Timeline Entry
                // ─────────────────────────────
                lead.timeline.push({
                    user: userId,
                    changes: [
                        {
                            field: "quotation",
                            oldValue: JSON.stringify(oldQuotationSnapshot),
                            newValue: "Deleted",
                        },
                    ],
                    updatedAt: new Date(),
                });

                lead.markModified("timeline");

                await lead.save();

                return res.status(200).json({
                    success: true,
                    message: "Quotation deleted successfully",
                });
            }

            // ============================================================
            // ✅ CASE 2 → DELETE SINGLE FILE (OLD LOGIC)
            // ============================================================

            if (!url) {
                return res.status(400).json({
                    success: false,
                    message: "url is required for file delete",
                });
            }

            const deletedFrom = [];

            // Lead files
            if (lead.lead?.aadharFile === url)
                deletedFrom.push("lead.aadharFile");

            if (lead.lead?.firmCompanyGstFile === url)
                deletedFrom.push("lead.firmCompanyGstFile");

            if (lead.lead?.panFile === url)
                deletedFrom.push("lead.panFile");

            if (lead.lead?.authLetterFile === url)
                deletedFrom.push("lead.authLetterFile");

            if (lead.lead?.contactPersonAadharFile === url)
                deletedFrom.push("lead.contactPersonAadharFile");

            if (lead.lead?.contactPersonPanFile === url)
                deletedFrom.push("lead.contactPersonPanFile");

            // Agreement / Security
            if (lead.aggrementDocument?.documents?.includes(url))
                deletedFrom.push("aggrementDocument.documents");

            if (lead.securityDocument?.documents?.includes(url))
                deletedFrom.push("securityDocument.documents");

            // Order / Dispatch / Return
            if (lead.order?.documents?.includes(url))
                deletedFrom.push("order.documents");

            if (lead.dispatch?.documents?.includes(url))
                deletedFrom.push("dispatch.documents");

            if (lead.return?.documents?.includes(url))
                deletedFrom.push("return.documents");

            // Billing
            if (lead.billing?.billFiles?.includes(url))
                deletedFrom.push("billing.billFiles");

            // FollowUps
            if (
                lead.leadFollowUps?.some(f =>
                    f.documents?.includes(url)
                )
            ) {
                deletedFrom.push("leadFollowUps.documents");
            }

            // Quotation files
            if (
                lead.quotation?.some(q =>
                    q.quotationFiles?.some(f => f.fileUrl === url)
                )
            ) {
                deletedFrom.push("quotation.quotationFiles");
            }

            // ─────────────────────────────
            // Pull & Set
            // ─────────────────────────────
            const pull = {
                "leadFollowUps.$[].documents": url,
                "order.documents": url,
                "aggrementDocument.documents": url,
                "securityDocument.documents": url,
                "dispatch.documents": url,
                "return.documents": url,
                "billing.billFiles": url,
                "quotation.$[].quotationFiles": { fileUrl: url },
            };

            const set = {
                "lead.aadharFile":
                    lead.lead.aadharFile === url ? "" : lead.lead.aadharFile,

                "lead.firmCompanyGstFile":
                    lead.lead.firmCompanyGstFile === url
                        ? ""
                        : lead.lead.firmCompanyGstFile,

                "lead.panFile":
                    lead.lead.panFile === url ? "" : lead.lead.panFile,

                "lead.authLetterFile":
                    lead.lead.authLetterFile === url
                        ? ""
                        : lead.lead.authLetterFile,

                "lead.contactPersonAadharFile":
                    lead.lead.contactPersonAadharFile === url
                        ? ""
                        : lead.lead.contactPersonAadharFile,

                "lead.contactPersonPanFile":
                    lead.lead.contactPersonPanFile === url
                        ? ""
                        : lead.lead.contactPersonPanFile,
            };

            await leadOrder.findOneAndUpdate(
                { _id: id },
                { $pull: pull, $set: set }
            );

            // ─────────────────────────────
            // Timeline Entry
            // ─────────────────────────────
            if (deletedFrom.length > 0) {
                lead.timeline.push({
                    user: userId,
                    changes: deletedFrom.map((fieldPath) => ({
                        field: fieldPath,
                        oldValue: url,
                        newValue: "Deleted",
                    })),
                    updatedAt: new Date(),
                });

                lead.markModified("timeline");
                await lead.save();
            }

            return res.status(200).json({
                success: true,
                message: "File deleted successfully",
            });

        } catch (error) {
            console.error("Delete file error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // Delete Lead Follow-Up
    async deleteLeadFollowUps(req, res) {
        try {
            const userId = req.user._id;
            const { leadId, followUpId } = req.params;

            if (!leadId || !followUpId) {
                return res.status(400).json({
                    success: false,
                    message: "Both leadId and followUpId are required.",
                });
            }

            // ─────────────────────────────
            // Find Lead
            // ─────────────────────────────
            const lead = await leadOrder.findById(leadId);

            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found.",
                });
            }

            if (!Array.isArray(lead.leadFollowUps)) {
                return res.status(404).json({
                    success: false,
                    message: "No follow-ups found on this lead.",
                });
            }

            // ─────────────────────────────
            // Find FollowUp to delete
            // ─────────────────────────────
            const followUpToDelete = lead.leadFollowUps.find(
                (fup) => fup._id.toString() === followUpId
            );

            if (!followUpToDelete) {
                return res.status(404).json({
                    success: false,
                    message: "Follow-up not found in this lead.",
                });
            }

            // ─────────────────────────────
            // Store OLD value for timeline
            // ─────────────────────────────
            const oldFollowUpSnapshot = {
                note: followUpToDelete.note || "",
                nextFollowUpDate: followUpToDelete.nextFollowUpDate || null,
                documents: followUpToDelete.documents || [],
                createdAt: followUpToDelete.createdAt || null,
            };

            // ─────────────────────────────
            // Delete FollowUp
            // ─────────────────────────────
            lead.leadFollowUps = lead.leadFollowUps.filter(
                (fup) => fup._id.toString() !== followUpId
            );

            lead.markModified("leadFollowUps");

            // ─────────────────────────────
            // Timeline Entry
            // ─────────────────────────────
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "leadFollowUps",
                        oldValue: JSON.stringify(oldFollowUpSnapshot),
                        newValue: "Deleted",
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            // ─────────────────────────────
            // Save
            // ─────────────────────────────
            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Lead follow-up deleted successfully.",
            });

        } catch (error) {
            console.error("Delete Lead Follow-Up error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // Delete Quotation Follow-Up
    async deleteQuotationFollowUps(req, res) {
        try {
            const userId = req.user._id;
            const { leadId, followUpId } = req.params;
            const { quotationId } = req.query;

            if (!leadId || !followUpId) {
                return res.status(400).json({
                    success: false,
                    message: "Both leadId and followUpId are required.",
                });
            }

            // ─────────────────────────────
            // Find Lead
            // ─────────────────────────────
            const lead = await leadOrder.findById(leadId);

            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found.",
                });
            }

            if (!Array.isArray(lead.quotation)) {
                return res.status(404).json({
                    success: false,
                    message: "No quotations found for this lead.",
                });
            }

            let followUpToDelete = null;
            let quotationMatched = null;

            // ─────────────────────────────
            // Case 1 → quotationId provided
            // ─────────────────────────────
            if (quotationId) {
                quotationMatched = lead.quotation.find(
                    (q) => q._id.toString() === quotationId
                );

                if (!quotationMatched) {
                    return res.status(404).json({
                        success: false,
                        message: "Quotation not found for this lead.",
                    });
                }

                followUpToDelete = quotationMatched.followUps?.find(
                    (fup) => fup._id.toString() === followUpId
                );

                if (!followUpToDelete) {
                    return res.status(404).json({
                        success: false,
                        message: "Follow-up not found in this quotation.",
                    });
                }

                quotationMatched.followUps =
                    quotationMatched.followUps.filter(
                        (fup) => fup._id.toString() !== followUpId
                    );
            }

            // ─────────────────────────────
            // Case 2 → Search all quotations
            // ─────────────────────────────
            else {
                for (const quotation of lead.quotation) {
                    const found = quotation.followUps?.find(
                        (fup) => fup._id.toString() === followUpId
                    );

                    if (found) {
                        followUpToDelete = found;
                        quotationMatched = quotation;

                        quotation.followUps =
                            quotation.followUps.filter(
                                (fup) => fup._id.toString() !== followUpId
                            );

                        break;
                    }
                }

                if (!followUpToDelete) {
                    return res.status(404).json({
                        success: false,
                        message: "Follow-up not found in any quotation.",
                    });
                }
            }

            // ─────────────────────────────
            // OLD Snapshot (only deleted object)
            // ─────────────────────────────
            const oldFollowUpSnapshot = {
                note: followUpToDelete.note || "",
                followUpDate: followUpToDelete.followUpDate || null,
                documents: followUpToDelete.documents || [],
                createdAt: followUpToDelete.createdAt || null,
            };

            lead.markModified("quotation");

            // ─────────────────────────────
            // Timeline Entry
            // ─────────────────────────────
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "quotation.followUps",
                        oldValue: JSON.stringify(oldFollowUpSnapshot),
                        newValue: "Deleted",
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            // ─────────────────────────────
            // Save
            // ─────────────────────────────
            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Quotation follow-up deleted successfully.",
            });

        } catch (error) {
            console.error("Delete quotation Follow-Up error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // Delete Payment Follow-Up
    async deletePaymentFollowUps(req, res) {
        try {
            const userId = req.user._id;
            const { leadId, followUpId } = req.params;

            if (!leadId || !followUpId) {
                return res.status(400).json({
                    success: false,
                    message: "Both leadId and followUpId are required.",
                });
            }

            // ─────────────────────────────
            // Find Lead
            // ─────────────────────────────
            const lead = await leadOrder.findById(leadId);

            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found.",
                });
            }

            if (!lead.payment || !Array.isArray(lead.payment.followUps)) {
                return res.status(404).json({
                    success: false,
                    message: "No payment follow-ups found for this lead.",
                });
            }

            // ─────────────────────────────
            // Find Follow-Up to Delete
            // ─────────────────────────────
            const followUpToDelete = lead.payment.followUps.find(
                (fup) => fup._id.toString() === followUpId
            );

            if (!followUpToDelete) {
                return res.status(404).json({
                    success: false,
                    message: "Payment follow-up not found.",
                });
            }

            // ─────────────────────────────
            // OLD Snapshot (only deleted object)
            // ─────────────────────────────
            const oldFollowUpSnapshot = {
                note: followUpToDelete.note || "",
                followUpDate: followUpToDelete.followUpDate || null,
                calledTo: followUpToDelete.calledTo || [],
                documents: followUpToDelete.documents || [],
                createdAt: followUpToDelete.createdAt || null,
            };

            // ─────────────────────────────
            // Delete Follow-Up
            // ─────────────────────────────
            lead.payment.followUps = lead.payment.followUps.filter(
                (fup) => fup._id.toString() !== followUpId
            );

            lead.markModified("payment.followUps");

            // ─────────────────────────────
            // Timeline Entry
            // ─────────────────────────────
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "payment.followUps",
                        oldValue: JSON.stringify(oldFollowUpSnapshot),
                        newValue: "Deleted",
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            // ─────────────────────────────
            // Save
            // ─────────────────────────────
            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Payment follow-up deleted successfully.",
            });

        } catch (error) {
            console.error("Delete Payment Follow-Up error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // Delete Payment Follow-Up
    async deleteBillingFollowUps(req, res) {
        try {
            const userId = req.user._id;
            const { leadId, followUpId } = req.params;

            if (!leadId || !followUpId) {
                return res.status(400).json({
                    success: false,
                    message: "Both leadId and followUpId are required.",
                });
            }

            // ─────────────────────────────
            // Find Lead
            // ─────────────────────────────
            const lead = await leadOrder.findById(leadId);

            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found.",
                });
            }

            if (!lead.billing || !Array.isArray(lead.billing.followUps)) {
                return res.status(404).json({
                    success: false,
                    message: "No billing follow-ups found for this lead.",
                });
            }

            // ─────────────────────────────
            // Find Follow-Up to delete
            // ─────────────────────────────
            const followUpToDelete = lead.billing.followUps.find(
                (fup) => fup._id.toString() === followUpId
            );

            if (!followUpToDelete) {
                return res.status(404).json({
                    success: false,
                    message: "Billing follow-up not found.",
                });
            }

            // ─────────────────────────────
            // OLD Snapshot (only deleted object)
            // ─────────────────────────────
            const oldFollowUpSnapshot = {
                note: followUpToDelete.note || "",
                followUpDate: followUpToDelete.followUpDate || null,
                documents: followUpToDelete.documents || [],
                createdAt: followUpToDelete.createdAt || null,
            };

            // ─────────────────────────────
            // Delete Follow-Up
            // ─────────────────────────────
            lead.billing.followUps = lead.billing.followUps.filter(
                (fup) => fup._id.toString() !== followUpId
            );

            lead.markModified("billing.followUps");

            // ─────────────────────────────
            // Timeline Entry (Readable)
            // ─────────────────────────────
            if (!Array.isArray(lead.timeline)) {
                lead.timeline = [];
            }

            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "billing.followUps",
                        oldValue: JSON.stringify(oldFollowUpSnapshot),
                        newValue: "Deleted",
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            // ─────────────────────────────
            // Save
            // ─────────────────────────────
            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Billing follow-up deleted successfully.",
            });

        } catch (error) {
            console.error("❌ Delete Billing Follow-Up error:", error);

            return res.status(500).json({
                success: false,
                message: "Internal Server Error",
                error: error.message,
            });
        }
    },

    // Delete Payment Follow-Up
    async deleteLegalFollowUps(req, res) {
        try {
            const userId = req.user._id;
            const { leadId, followUpId } = req.params;

            if (!leadId || !followUpId) {
                return res.status(400).json({
                    success: false,
                    message: "Both leadId and followUpId are required.",
                });
            }

            // ─────────────────────────────
            // Find Lead
            // ─────────────────────────────
            const lead = await leadOrder.findById(leadId);

            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found.",
                });
            }

            if (!lead.legal || !Array.isArray(lead.legal.followUps)) {
                return res.status(404).json({
                    success: false,
                    message: "No legal follow-ups found for this lead.",
                });
            }

            // ─────────────────────────────
            // Find Follow-Up to Delete
            // ─────────────────────────────
            const followUpToDelete = lead.legal.followUps.find(
                (fup) => fup._id.toString() === followUpId
            );

            if (!followUpToDelete) {
                return res.status(404).json({
                    success: false,
                    message: "Legal follow-up not found.",
                });
            }

            // ─────────────────────────────
            // OLD Snapshot (only deleted object)
            // ─────────────────────────────
            const oldFollowUpSnapshot = {
                note: followUpToDelete.note || "",
                followUpDate: followUpToDelete.followUpDate || null,
                documents: followUpToDelete.documents || [],
                createdAt: followUpToDelete.createdAt || null,
            };

            // ─────────────────────────────
            // Delete Follow-Up
            // ─────────────────────────────
            lead.legal.followUps = lead.legal.followUps.filter(
                (fup) => fup._id.toString() !== followUpId
            );

            lead.markModified("legal.followUps");

            // ─────────────────────────────
            // Timeline Entry
            // ─────────────────────────────
            if (!Array.isArray(lead.timeline)) {
                lead.timeline = [];
            }

            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: "legal.followUps",
                        oldValue: JSON.stringify(oldFollowUpSnapshot),
                        newValue: "Deleted",
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            // ─────────────────────────────
            // Save
            // ─────────────────────────────
            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Legal follow-up deleted successfully.",
            });

        } catch (error) {
            console.error("Delete Legal Follow-Up error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // Delete Sub Data of the fields
    async deleteSubData(req, res) {
        try {
            const { leadId, id } = req.params;
            const { section } = req.query;

            const userId = req.user?._id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: "Unauthorized access",
                });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found",
                });
            }

            // ─────────────────────────────
            // Validate Section
            // ─────────────────────────────
            const subSection = sectionMap[section];

            if (!subSection) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid section name",
                });
            }

            // ─────────────────────────────
            // Find Lead
            // ─────────────────────────────
            const lead = await leadOrder.findById(leadId);

            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found",
                });
            }

            const dataArray = lead?.[section]?.[subSection];

            if (!Array.isArray(dataArray)) {
                return res.status(400).json({
                    success: false,
                    message: `${subSection} not found under ${section}`,
                });
            }

            // ─────────────────────────────
            // Find Item
            // ─────────────────────────────
            const itemIndex = dataArray.findIndex(
                (item) => item._id.toString() === id
            );

            if (itemIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message: `Item not found in ${subSection}`,
                });
            }

            const itemToDelete = dataArray[itemIndex];

            // ─────────────────────────────
            // 🧠 Build FULL Parent Snapshot
            // ─────────────────────────────
            let oldSnapshot = itemToDelete.toObject
                ? itemToDelete.toObject()
                : JSON.parse(JSON.stringify(itemToDelete));

            // Remove Mongo junk
            delete oldSnapshot._id;
            delete oldSnapshot.__v;
            delete oldSnapshot.createdAt;
            delete oldSnapshot.updatedAt;
            delete oldSnapshot.user;

            // ─────────────────────────────
            // Remove item
            // ─────────────────────────────
            lead[section][subSection].splice(itemIndex, 1);

            lead.markModified(`${section}.${subSection}`);

            // ─────────────────────────────
            // Timeline Entry
            // ─────────────────────────────
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: `${section}`,
                        oldValue: JSON.stringify(oldSnapshot),
                        newValue: "Deleted",
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            await lead.save();

            // ─────────────────────────────
            // Response
            // ─────────────────────────────
            res.status(200).json({
                success: true,
                message: `Entry deleted from ${section} section`,
            });

        } catch (error) {
            console.error("Delete SubData Error:", error);

            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // Edit Sub Data of the fields
    async editSubData(req, res) {
        try {
            const { leadId, id } = req.params;
            const { section } = req.query;
            let updateData = req.body;

            // Parse multipart JSON
            if (typeof updateData === "string") {
                try {
                    updateData = JSON.parse(updateData);
                } catch {
                    updateData = {};
                }
            }

            const userId = req.user?._id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: "Unauthorized access",
                });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found",
                });
            }

            const subSection = sectionMap[section];

            if (!subSection) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid section name",
                });
            }

            const lead = await leadOrder.findById(leadId);

            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found",
                });
            }

            const dataArray = lead?.[section]?.[subSection];

            if (!Array.isArray(dataArray)) {
                return res.status(400).json({
                    success: false,
                    message: `${subSection} not found under ${section}`,
                });
            }

            const index = dataArray.findIndex(
                (item) => item._id.toString() === id
            );

            if (index === -1) {
                return res.status(404).json({
                    success: false,
                    message: `Item not found in ${subSection}`,
                });
            }

            // ─────────────────────────────
            // OLD Snapshot (Parent)
            // ─────────────────────────────
            let oldSnapshot = dataArray[index].toObject
                ? dataArray[index].toObject()
                : JSON.parse(JSON.stringify(dataArray[index]));

            delete oldSnapshot._id;
            delete oldSnapshot.__v;
            delete oldSnapshot.createdAt;
            delete oldSnapshot.updatedAt;
            delete oldSnapshot.user;

            // ─────────────────────────────
            // Handle File Uploads (merge only)
            // ─────────────────────────────
            let uploadedUrls = [];

            const uploadFieldMap = {
                order: "orderDataDocuments",
                dispatch: "dispatchDataDocuments",
                return: "returnDataDocuments",
                billing: "billingDataFiles",
                payment: "paymentDataFiles",
            };

            const uploadKey = uploadFieldMap[section];

            if (uploadKey && req.files?.[uploadKey]) {
                for (const file of req.files[uploadKey]) {
                    const uploaded = await uploadToS3(
                        file.buffer,
                        file.originalname,
                        file.mimetype
                    );
                    uploadedUrls.push(uploaded.Location);
                }
            }

            // Merge files silently (no diff logging)
            if (uploadedUrls.length > 0) {
                if (section === "billing") {
                    updateData.billFiles = [
                        ...(oldSnapshot.billFiles || []),
                        ...uploadedUrls,
                    ];
                } else {
                    updateData.documents = [
                        ...(oldSnapshot.documents || []),
                        ...uploadedUrls,
                    ];
                }
            }

            // ─────────────────────────────
            // Apply Update
            // ─────────────────────────────
            dataArray[index] = {
                ...dataArray[index]._doc,
                ...updateData,
            };

            lead[section][subSection] = dataArray;
            lead.markModified(`${section}.${subSection}`);

            // ─────────────────────────────
            // NEW Snapshot
            // ─────────────────────────────
            let newSnapshot = dataArray[index].toObject
                ? dataArray[index].toObject()
                : JSON.parse(JSON.stringify(dataArray[index]));

            delete newSnapshot._id;
            delete newSnapshot.__v;
            delete newSnapshot.createdAt;
            delete newSnapshot.updatedAt;
            delete newSnapshot.user;

            // ─────────────────────────────
            // Timeline (ONLY Parent Diff)
            // ─────────────────────────────
            lead.timeline.push({
                user: userId,
                changes: [
                    {
                        field: `${section}`,
                        oldValue: JSON.stringify(oldSnapshot),
                        newValue: JSON.stringify(newSnapshot),
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            await lead.save();

            res.status(200).json({
                success: true,
                message: `Updated entry in ${section} section`,
                updatedData: dataArray[index],
            });

        } catch (error) {
            console.error("❌ Error editing sub data:", error);

            res.status(500).json({
                success: false,
                message: "Server error",
                error: error.message,
            });
        }
    },

    // Show Follow-Ups
    // async showFollowUps(req, res) {
    //     try {
    //         const userId = req.user._id;
    //         const { type, page = 1, limit = 10, search = "", addedBy } = req.query;

    //         if (!type) {
    //             return res.status(400).json({ success: false, message: "Type is required" });
    //         }

    //         // 🔐 Verify user
    //         const user = await User.findById(userId);
    //         if (!user) {
    //             return res.status(404).json({ success: false, message: "User not found" });
    //         }

    //         // 🔒 Access control (Admin → all, others → only own/assigned)
    //         let accessFilter = {};
    //         if (user.role?.toLowerCase() !== "admin") {
    //             accessFilter = {
    //                 $or: [{ addedBy: userId }, { "leadAllotedTo.user": userId.toString() }],
    //             };
    //         }

    //         // 🧠 Optional addedBy filter for Admins
    //         let addedByFilter = {};
    //         if (addedBy?.trim()) {
    //             addedByFilter = { addedBy };
    //         }

    //         const combinedFilter = { ...accessFilter, ...addedByFilter };
    //         const leads = await leadOrder.find(combinedFilter);

    //         if (!leads.length) {
    //             return res.status(200).json({
    //                 success: true,
    //                 message: "No leads found",
    //                 data: [],
    //                 totalLeads: 0,
    //                 totalDefaulters: 0,
    //             });
    //         }

    //         // 🧮 Totals
    //         const totalLeads = leads.length;
    //         const totalDefaulters = leads.filter(
    //             (lead) => lead.status?.toLowerCase() === "marked defaulter"
    //         ).length;
    //         const totalLegal = leads.filter(
    //             (lead) => lead.status?.toLowerCase() === "marked legal"
    //         ).length;

    //         // 📅 Reference for today
    //         const today = new Date();
    //         today.setHours(0, 0, 0, 0);

    //         let filteredLeads = [];

    //         // ✅ Helper: pick latest created follow-up per lead/type
    //         const getLatestFollowUp = (followUps, dateField) => {
    //             if (!followUps?.length) return null;

    //             // 1️⃣ Pick latest created follow-up
    //             const latestFollowUp = followUps.reduce((latest, current) =>
    //                 new Date(current.createdAt) > new Date(latest.createdAt)
    //                     ? current
    //                     : latest
    //             );

    //             // 2️⃣ Must be upcoming (today or later)
    //             if (!latestFollowUp[dateField] || new Date(latestFollowUp[dateField]) < today)
    //                 return null;

    //             return latestFollowUp;
    //         };

    //         // 🔁 Loop through all leads by type
    //         for (const lead of leads) {
    //             let latest = null;
    //             let dateField = "";

    //             if (type === "lead" && lead.leadFollowUps?.length) {
    //                 dateField = "nextFollowUpDate";
    //                 latest = getLatestFollowUp(lead.leadFollowUps, dateField);
    //             }

    //             if (type === "quotation" && lead.quotation?.followUps?.length) {
    //                 dateField = "followUpDate";
    //                 latest = getLatestFollowUp(lead.quotation.followUps, dateField);
    //             }

    //             if (type === "payment" && lead.payment?.followUps?.length) {
    //                 dateField = "followUpDate";
    //                 latest = getLatestFollowUp(lead.payment.followUps, dateField);
    //             }

    //             if (type === "billing" && lead.billing?.followUps?.length) {
    //                 dateField = "followUpDate";
    //                 latest = getLatestFollowUp(lead.billing.followUps, dateField);
    //             }

    //             if (
    //                 type === "legal" &&
    //                 totalLegal > 0 &&
    //                 lead.status?.toLowerCase() === "marked legal" &&
    //                 lead.legal?.followUps?.length
    //             ) {
    //                 dateField = "followUpDate";
    //                 latest = getLatestFollowUp(lead.legal.followUps, dateField);
    //             }

    //             if (latest) {
    //                 filteredLeads.push({
    //                     leadId: lead._id,
    //                     companyName: lead.lead?.name || "",
    //                     contactPersonName: lead.lead?.contactPersonName || "",
    //                     contactPersonPhone: lead.lead?.contactPersonPhone || "",
    //                     contactPersonInfo: lead.lead?.contactPersonInfo || "",
    //                     siteAddress: lead.lead?.siteAddress || "",
    //                     customerAddress: lead.lead?.customerAddress || "",
    //                     status: lead.status || "",
    //                     createdAt: latest.createdAt,
    //                     nextFollowUpDate:
    //                         type === "lead" ? latest.nextFollowUpDate : latest.followUpDate,
    //                     followUpNote: latest.note || "",
    //                 });
    //             }
    //         }

    //         // 🔍 Apply search filter
    //         if (search.trim()) {
    //             const searchLower = search.toLowerCase();
    //             filteredLeads = filteredLeads.filter((lead) =>
    //                 Object.values({
    //                     companyName: lead.companyName,
    //                     contactPersonName: lead.contactPersonName,
    //                     contactPersonPhone: lead.contactPersonPhone,
    //                     contactPersonInfo: lead.contactPersonInfo,
    //                     siteAddress: lead.siteAddress,
    //                     customerAddress: lead.customerAddress,
    //                     status: lead.status,
    //                 })
    //                     .join(" ")
    //                     .toLowerCase()
    //                     .includes(searchLower)
    //             );
    //         }

    //         // ✅ Sort by:
    //         // 1️⃣ Latest createdAt first (DESC)
    //         // 2️⃣ Closest upcoming follow-up date next (ASC)
    //         filteredLeads.sort((a, b) => {
    //             const createdDiff = new Date(b.createdAt) - new Date(a.createdAt);
    //             if (createdDiff !== 0) return createdDiff;
    //             return new Date(a.nextFollowUpDate) - new Date(b.nextFollowUpDate);
    //         });

    //         // 🧾 Pagination
    //         const totalCount = filteredLeads.length;
    //         const startIndex = (page - 1) * limit;
    //         const paginatedLeads = filteredLeads.slice(
    //             startIndex,
    //             startIndex + parseInt(limit)
    //         );

    //         return res.status(200).json({
    //             success: true,
    //             message: `Upcoming ${type} follow-ups fetched successfully`,
    //             count: paginatedLeads.length,
    //             data: paginatedLeads,
    //             totalLeads,
    //             totalDefaulters,
    //             pagination: {
    //                 totalCount,
    //                 currentPage: Number(page),
    //                 totalPages: Math.ceil(totalCount / limit),
    //             },
    //         });
    //     } catch (error) {
    //         console.error("Show Follow-Ups error:", error);
    //         res.status(500).json({
    //             success: false,
    //             message: "Server Error",
    //             error: error.message,
    //         });
    //     }
    // },
    async showFollowUps(req, res) {
        try {
            const userId = req.user._id;
            const { type, page = 1, limit = 10, search = "", addedBy, filter } = req.query;

            if (!type) {
                return res.status(400).json({ success: false, message: "Type is required" });
            }

            // 🔐 Verify user
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // 🔒 Access control (Admin → all, others → only own/assigned)
            // let accessFilter = {};
            // if (user.role?.toLowerCase() !== "admin") {
            //     accessFilter = {
            //         $or: [
            //             { addedBy: userId },
            //             { "leadAllotedTo.user": userId.toString() }
            //         ],
            //     };
            // }
            // 🔒 Access control logic
            let accessFilter = {};

            if (user.role?.toLowerCase() === "admin") {
                // 🧠 Admins see all leads (no restriction)
                accessFilter = {};
            } else {
                // 🧠 Non-admins: see only leads where they are alloted
                accessFilter = { "leadAllotedTo.user": userId.toString() };
            }


            // 🧠 Optional addedBy filter for Admins
            let addedByFilter = {};
            if (addedBy?.trim()) {
                addedByFilter = { addedBy };
            }

            const combinedFilter = { ...accessFilter, ...addedByFilter };
            const leads = await leadOrder
                .find(combinedFilter)
                .populate("addedBy", "name") // only fetch name, email, and role
                // .populate("LeadOrder") // if 'lead' is another referenced model
                .lean(); // lean() for faster read-only ops;

            if (!leads.length) {
                return res.status(200).json({
                    success: true,
                    message: "No leads found",
                    data: [],
                    totalLeads: 0,
                    totalDefaulters: 0,
                });
            }

            // 🧮 Totals
            const totalLeads = leads.length;
            const totalDefaulters = leads.filter(
                (lead) => lead.status?.toLowerCase() === "marked defaulter"
            ).length;
            const totalLegal = leads.filter(
                (lead) => lead.status?.toLowerCase() === "marked legal"
            ).length;

            // 📅 Reference for today
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);


            let filteredLeads = [];

            // ✅ Helper: pick latest created follow-up per lead/type
            const getLatestFollowUp = (followUps, dateField) => {
                if (!followUps?.length) return null;

                // 🧠 1️⃣ Keep only follow-ups with valid future/today dates
                const validFollowUps = followUps.filter(
                    f => f[dateField] && new Date(f[dateField]) >= today
                );
                if (!validFollowUps.length) return null;

                // 🧠 2️⃣ Pick the *latest created* follow-up among those
                const latestFollowUp = validFollowUps.reduce((latest, current) =>
                    new Date(current.createdAt) > new Date(latest.createdAt) ? current : latest
                );

                // 🧠 3️⃣ Apply filter logic (today, upcoming, all)
                const followUpDate = new Date(latestFollowUp[dateField]);
                if (filter === "today") {
                    if (followUpDate >= today && followUpDate < tomorrow) {
                        return latestFollowUp;
                    }
                } else if (filter === "upcoming") {
                    if (followUpDate >= tomorrow) {
                        return latestFollowUp;
                    }
                } else {
                    // Default: today + upcoming
                    if (followUpDate >= today) {
                        return latestFollowUp;
                    }
                }

                return null;
            };



            // 🔁 Loop through all leads by type
            for (const lead of leads) {
                let latest = null;
                let dateField = "";

                if (type === "lead" && lead.leadFollowUps?.length) {
                    dateField = "nextFollowUpDate";
                    latest = getLatestFollowUp(lead.leadFollowUps, dateField);
                }

                if (type === "quotation" && lead.quotation?.followUps?.length) {
                    dateField = "followUpDate";
                    latest = getLatestFollowUp(lead.quotation.followUps, dateField);
                }

                if (type === "payment" && lead.payment?.followUps?.length) {
                    dateField = "followUpDate";
                    latest = getLatestFollowUp(lead.payment.followUps, dateField);
                }

                if (type === "billing" && lead.billing?.followUps?.length) {
                    dateField = "followUpDate";
                    latest = getLatestFollowUp(lead.billing.followUps, dateField);
                }

                if (
                    type === "legal" &&
                    totalLegal > 0 &&
                    lead.status?.toLowerCase() === "marked legal" &&
                    lead.legal?.followUps?.length
                ) {
                    dateField = "followUpDate";
                    latest = getLatestFollowUp(lead.legal.followUps, dateField);
                }

                if (latest) {
                    filteredLeads.push({
                        addedBy: {
                            _id: lead.addedBy?._id || "",
                            name: lead.addedBy?.name || "N/A",
                        },
                        leadId: lead._id,
                        companyName: lead.lead?.name || "",
                        contactPersonName: lead.lead?.contactPersonName || "",
                        contactPersonPhone: lead.lead?.contactPersonPhone || "",
                        contactPersonInfo: lead.lead?.contactPersonInfo || "",
                        siteAddress: lead.lead?.siteAddress || "",
                        customerAddress: lead.lead?.customerAddress || "",
                        status: lead.status || "",
                        createdAt: latest.createdAt,
                        nextFollowUpDate:
                            type === "lead" ? latest.nextFollowUpDate : latest.followUpDate,
                        followUpNote: latest.note || "",
                    });
                }
            }

            // 🔍 Apply search filter
            if (search.trim()) {
                const searchLower = search.toLowerCase();
                filteredLeads = filteredLeads.filter((lead) =>
                    Object.values({
                        companyName: lead.companyName,
                        contactPersonName: lead.contactPersonName,
                        contactPersonPhone: lead.contactPersonPhone,
                        contactPersonInfo: lead.contactPersonInfo,
                        siteAddress: lead.siteAddress,
                        customerAddress: lead.customerAddress,
                        status: lead.status,
                    })
                        .join(" ")
                        .toLowerCase()
                        .includes(searchLower)
                );
            }

            // ✅ Sort by:
            // 1️⃣ Latest createdAt first (DESC)
            // 2️⃣ Closest upcoming follow-up date next (ASC)
            filteredLeads.sort((a, b) => {
                // 1️⃣ Closest follow-up date first
                const dateDiff = new Date(a.nextFollowUpDate) - new Date(b.nextFollowUpDate);
                if (dateDiff !== 0) return dateDiff;

                // 2️⃣ If same date, show the earliest created one first
                return new Date(a.createdAt) - new Date(b.createdAt);
            });


            // 🧾 Pagination
            const totalCount = filteredLeads.length;
            const startIndex = (page - 1) * limit;
            const paginatedLeads = filteredLeads.slice(
                startIndex,
                startIndex + parseInt(limit)
            );

            return res.status(200).json({
                success: true,
                message: `Upcoming ${type} follow-ups fetched successfully`,
                count: paginatedLeads.length,
                data: paginatedLeads,
                totalLeads,
                totalDefaulters,
                pagination: {
                    totalCount,
                    currentPage: Number(page),
                    totalPages: Math.ceil(totalCount / limit),
                },
            });
        } catch (error) {
            console.error("Show Follow-Ups error:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // 📦 Get Closest Follow-Ups (for Dashboard)
    async getDashboardFollowUps(req, res) {
        try {
            const userId = req.user._id;

            // ✅ Verify user exists
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // 🔒 Role-based access filter
            let accessFilter = {};
            // if (user.role?.toLowerCase() !== "admin") {
            //     accessFilter = {
            //         $or: [
            //             { addedBy: userId },
            //             { "leadAllotedTo.user": userId.toString() },
            //         ],
            //     };
            // }
            if (user.role?.toLowerCase() !== "admin") {
                accessFilter = { "leadAllotedTo.user": userId.toString() };
            }




            // ✅ Priority: Customer > Alloted > Status categories > Others
            let totalCustomers = 0;
            let totalAlloted = 0;
            let totalAllotedToUser = 0;
            let totalDefaulters = 0;
            let totalComplete = 0;
            let totalDiscard = 0;
            let totalLegal = 0;
            let totalLeads = 0;

            // ✅ Separate filter logic for customer view where the customer count will show acc to the user's customer view access
            const allLeads = await leadOrder.find(); // used only for global customer count
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // --- 1️⃣ Handle Customer Count ---
            // if (user.isCustomerView) {
            //     // 🟢 If user has full customer view access, show all customers
            //     totalCustomers = allLeads.filter((lead) => lead.isCustomer).length;
            // } else {
            //     // 🔒 Show only the customers added or alloted to this user
            //     totalCustomers = leads.filter(
            //         (lead) =>
            //             lead.isCustomer &&
            //             (
            //                 lead.addedBy?.toString() === userId.toString() ||
            //                 lead.leadAllotedTo?.some(
            //                     (a) => a.user?.toString() === userId.toString()
            //                 ))
            //     ).length;
            // }
            if (user.isCustomerView) {
                // 🟢 Show all customers regardless of alloted or addedBy
                totalCustomers = await leadOrder.countDocuments({ isCustomer: true });
            } else {
                // 🔒 Show only customers alloted to this user
                totalCustomers = await leadOrder.countDocuments({
                    isCustomer: true,
                    "leadAllotedTo.user": userId.toString(),
                });
            }

            // ✅ Get all leads
            const leads = await leadOrder.find(accessFilter);

            if (!leads.length) {
                return res.status(200).json({
                    success: true,
                    message: "No leads found",
                    leadFollowUps: [],
                    quotationFollowUps: [],
                    paymentFollowUps: [],
                    billingFollowUps: [],
                    legalFollowUps: [],
                    totalLeads: 0,
                    totalDefaulters: 0,
                    totalComplete: 0,
                    totalDiscard: 0,
                    totalLegal: 0,
                    totalCustomers: totalCustomers,
                    totalAllotedToUser: 0,
                    totalAlloted: 0,
                });
            }

            // --- 2️⃣ Loop for all other counts ---
            for (const lead of leads) {
                // Skip already counted customers (since done above)
                if (lead.isCustomer) continue;

                //     if (lead.isCustomer) {
                //         totalCustomers++;
                //         continue;
                //     }

                // --- 2️⃣ Status categories ---
                const status = lead.status?.toLowerCase();


                // Common check for any upcoming follow-ups
                const hasUpcomingFollowUp =
                    (lead.leadFollowUps?.some(f => f.nextFollowUpDate && new Date(f.nextFollowUpDate) >= today)) ||
                    (lead.quotation?.followUps?.some(f => f.followUpDate && new Date(f.followUpDate) >= today)) ||
                    (lead.payment?.followUps?.some(f => f.followUpDate && new Date(f.followUpDate) >= today)) ||
                    (lead.billing?.followUps?.some(f => f.followUpDate && new Date(f.followUpDate) >= today)) ||
                    (lead.legal?.followUps?.some(f => f.followUpDate && new Date(f.followUpDate) >= today));


                if (status === "marked legal") {
                    totalLegal++;
                    continue;
                }
                if (status === "marked defaulter") {
                    totalDefaulters++;
                    continue;
                }
                if (status === "marked complete") {
                    totalComplete++;
                    continue;
                }
                if (status === "marked discard") {
                    totalDiscard++;
                    continue;
                }

                // --- 3️⃣ Alloted ---
                const isAlloted =
                    Array.isArray(lead.leadAllotedTo) && lead.leadAllotedTo.length > 0;

                if (isAlloted) {
                    totalAlloted++;

                    // Check if user is directly or indirectly related to this alloted lead
                    const isAllotedToUser =
                        lead.leadAllotedTo.some(
                            (a) => a.user?.toString() === userId.toString()
                        );

                    const isUserCreatedAndAlloted =
                        lead.addedBy?.toString() === userId.toString() && isAlloted;

                    if (isAllotedToUser) {
                        // if (isAllotedToUser || isUserCreatedAndAlloted) {
                        totalAllotedToUser++;
                    }

                    continue;
                }

                // --- 4️⃣ Unassigned (Pure leads) ---
                // --- 4️⃣ Unassigned (Pure leads) ---
                // Skip counting if lead already has any upcoming follow-up

                // --- 4️⃣ Unassigned (Pure leads) ---
                if (
                    !lead.isCustomer &&
                    !["marked legal", "marked defaulter", "marked complete", "marked discard"].includes(status)
                ) {
                    if (!hasUpcomingFollowUp) {
                        totalLeads++;
                    }
                }


            }

            // ✅ Today reference
            // const today = new Date();
            // today.setHours(0, 0, 0, 0);

            const leadFollowUps = [];
            const quotationFollowUps = [];
            const paymentFollowUps = [];
            const billingFollowUps = [];
            const legalFollowUps = [];

            // ✅ Collect the latest follow-up per lead per type
            for (const lead of leads) {
                const processFollowUps = (followUps, targetArray, dateField) => {
                    if (!followUps?.length) return;

                    // 🧠 1️⃣ Filter future or today follow-ups
                    const validFollowUps = followUps.filter(
                        (f) => f[dateField] && new Date(f[dateField]) >= today
                    );
                    if (!validFollowUps.length) return;

                    // 🧠 2️⃣ Pick the latest created follow-up among them
                    const latestFollowUp = validFollowUps.reduce((latest, current) =>
                        new Date(current.createdAt) > new Date(latest.createdAt) ? current : latest
                    );

                    // 🧠 3️⃣ Push that latest one
                    targetArray.push({
                        leadId: lead._id,
                        companyName: lead.lead?.name || "",
                        status: lead.status || "",
                        createdAt: latestFollowUp.createdAt,
                        followUpNote: latestFollowUp.note || "",
                        followUpDate: latestFollowUp[dateField] || "",
                    });
                };



                // ---- LEAD FOLLOW-UPS ----
                processFollowUps(lead.leadFollowUps, leadFollowUps, "nextFollowUpDate");

                // ---- QUOTATION FOLLOW-UPS ----
                processFollowUps(lead.quotation?.followUps, quotationFollowUps, "followUpDate");

                // ---- PAYMENT FOLLOW-UPS ----
                processFollowUps(lead.payment?.followUps, paymentFollowUps, "followUpDate");

                // ---- BILLING FOLLOW-UPS ----
                processFollowUps(lead.billing?.followUps, billingFollowUps, "followUpDate");

                // ---- LEGAL FOLLOW-UPS ----
                if (lead.status?.toLowerCase() === "marked legal") {
                    processFollowUps(lead.legal?.followUps, legalFollowUps, "followUpDate");
                }
            }

            // ✅ Sort globally across all leads
            // 1️⃣ Latest created first
            // 2️⃣ Closest upcoming date next
            const sortFollowUps = (arr) =>
                arr
                    .sort((a, b) => {
                        const dateDiff = new Date(a.followUpDate) - new Date(b.followUpDate);
                        if (dateDiff !== 0) return dateDiff;
                        return new Date(a.createdAt) - new Date(b.createdAt);
                    })
                    .slice(0, 5);
            // Optional: keep only top 5

            const recentLeadFollowUps = sortFollowUps(leadFollowUps);
            const recentQuotationFollowUps = sortFollowUps(quotationFollowUps);
            const recentPaymentFollowUps = sortFollowUps(paymentFollowUps);
            const recentBillingFollowUps = sortFollowUps(billingFollowUps);
            const recentLegalFollowUps = sortFollowUps(legalFollowUps);

            // ✅ Final response
            return res.status(200).json({
                success: true,
                message: "Closest 5 upcoming (today/future) follow-ups fetched successfully",
                totalLeads,
                totalDefaulters,
                totalComplete,
                totalDiscard,
                totalLegal,
                totalCustomers,
                totalAllotedToUser,
                totalAlloted,
                leadFollowUps: recentLeadFollowUps,
                quotationFollowUps: recentQuotationFollowUps,
                paymentFollowUps: recentPaymentFollowUps,
                billingFollowUps: recentBillingFollowUps,
                legalFollowUps: recentLegalFollowUps,
            });
        } catch (error) {
            console.error("Get Dashboard Follow-Ups Error:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // Get the top 5 lead whos payment status is "Paid" and also get the top 5 lead who have the quotation files
    async getDashboardData(req, res) {
        try {
            const userId = req.user._id;

            // ✅ Verify user exists
            const user = await User.findById(userId);
            if (!user) {
                return res
                    .status(404)
                    .json({ success: false, message: "User not found" });
            }

            // 🔒 Role-based access filter
            let accessFilter = {};
            if (user.role?.toLowerCase() !== "admin") {
                accessFilter = {
                    $or: [
                        { addedBy: userId },
                        { "leadAllotedTo.user": userId.toString() },
                    ],
                };
            }

            // ✅ Top 5 leads with payment.status = "Paid"
            const paidLeads = await leadOrder.find({
                "payment.status": "Paid",
                ...accessFilter,
            })
                .select("lead.name payment isCustomer")
                .sort({ updatedAt: -1 }) // recent first
                .limit(5)
                .lean();

            // ✅ Top 5 leads that have quotation files
            // ✅ Top 5 quotations (can include multiple from same lead)
            const quotationLeads = await leadOrder.aggregate([
                // Step 1: Unwind quotations
                { $unwind: "$quotation" },

                // Step 2: Match only quotations that have files
                {
                    $match: {
                        "quotation.quotationFiles": {
                            $elemMatch: { fileUrl: { $exists: true, $ne: "" } },
                        },
                        ...accessFilter,
                    },
                }
                ,

                // Step 3: Sort by updatedAt descending
                {
                    $sort: {
                        "quotation.updatedAt": -1,
                    },
                },

                // Step 4: Add fallback for missing updatedAt (use sentDate)
                {
                    $addFields: {
                        sortDate: {
                            $ifNull: ["$quotation.updatedAt", "$quotation.sentDate"],
                        },
                    },
                },

                // Step 5: Sort again by sortDate descending
                {
                    $sort: {
                        sortDate: -1,
                    },
                },

                // Step 6: Limit to top 5 (can include multiple quotations from the same lead)
                { $limit: 5 },

                // Step 7: Keep same response shape as your old .find() result
                {
                    $project: {
                        _id: 1,
                        lead: { name: "$lead.name" },
                        quotation: [
                            {
                                quotationFiles: "$quotation.quotationFiles",
                                sentDate: "$quotation.sentDate",
                                items: "$quotation.items",
                                grandTotalAfterGST: "$quotation.grandTotalAfterGST",
                                updatedAt: "$quotation.updatedAt",
                            },
                        ],
                        isCustomer: 1,
                    },
                },
            ]);


            return res.status(200).json({
                success: true,
                topPaidLeads: paidLeads,
                topQuotationLeads: quotationLeads,

            });
        } catch (error) {
            console.error("Server error: ", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // Get the all lead whos payment status is "Paid" and also get the lead who have the quotation files
    async showData(req, res) {
        try {
            const userId = req.user._id;
            const { type, page = 1, limit = 10, search = "", addedBy } = req.query;

            // Validate type
            if (!type) {
                return res.status(400).json({
                    success: false,
                    message: "Type is required",
                });
            }

            // Check user existence
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found",
                });
            }

            // ✅ Build base query based on type
            let query = {};

            if (type === "paid") {
                query = { "payment.status": "Paid" };
            } else if (type === "quotationfiles") {
                // Match any lead having at least one quotation with a file
                // Match quotations with at least one file (object with fileUrl) or old string-based quotations
                query = {
                    $or: [
                        { "quotation.quotationFiles": { $elemMatch: { fileUrl: { $exists: true, $ne: "" } } } },
                        { "quotation.quotationFiles.0": { $type: "string" } },
                    ],
                };
            }

            // 🔒 Role-based filter
            let accessFilter = {};
            if (user.role?.toLowerCase() !== "admin") {
                accessFilter = {
                    $or: [
                        // { addedBy: userId },
                        { "leadAllotedTo.user": userId.toString() }
                    ],
                };
            }

            // 🧠 AddedBy filter (Admin only)
            let addedByFilter = {};
            if (addedBy && addedBy.trim() !== "") {
                addedByFilter = { addedBy: addedBy };
            }

            const combinedFilter = { ...query, ...accessFilter, ...addedByFilter };

            // ✅ Fetch filtered leads sorted by updatedAt
            const leads = await leadOrder
                .find(combinedFilter)
                .sort({ updatedAt: -1 })
                .lean();

            if (!leads.length) {
                return res.status(200).json({
                    success: true,
                    message: "No leads found",
                    data: [],
                    totalLeads: 0,
                    totalDefaulters: 0,
                    totalLegal: 0,
                    pagination: {
                        totalCount: 0,
                        currentPage: Number(page),
                        totalPages: 0,
                    },
                });
            }

            // ✅ Calculate stats
            const totalLeads = leads.length;
            const totalDefaulters = leads.filter(
                (lead) => lead.status?.toLowerCase() === "marked defaulter"
            ).length;
            const totalLegal = leads.filter(
                (lead) => lead.status?.toLowerCase() === "marked legal"
            ).length;

            // ✅ Map final structure
            let filteredLeads = [];

            // 🧾 Paid type
            if (type === "paid") {
                filteredLeads = leads.map((lead) => ({
                    leadId: lead._id,
                    companyName: lead.lead?.name || "",
                    contactPersonName: lead.lead?.contactPersonName || "",
                    contactPersonPhone: lead.lead?.contactPersonPhone || "",
                    contactPersonInfo: lead.lead?.contactPersonInfo || "",
                    siteAddress: lead.lead?.siteAddress || "",
                    customerAddress: lead.lead?.customerAddress || "",
                    status: lead.status || "",
                    amountPaid: lead.payment?.amountPaid || 0,
                    dueDate: lead.payment?.dueDate || null,
                    paymentStatus: lead.payment?.status || "",
                    isCustomer: lead.isCustomer || false,
                    createdAt: lead.createdAt,
                    updatedAt: lead.updatedAt,
                }));
            }

            // 🧾 Quotation Files type
            if (type === "quotationfiles") {
                filteredLeads = leads.flatMap((lead) => {
                    // handle case where quotation is array
                    if (Array.isArray(lead.quotation)) {
                        return lead.quotation
                            .filter((q) => q?.quotationFiles?.length > 0)
                            .map((q) => ({
                                leadId: lead._id,
                                companyName: lead.lead?.name || "",
                                contactPersonName: lead.lead?.contactPersonName || "",
                                contactPersonPhone: lead.lead?.contactPersonPhone || "",
                                contactPersonInfo: lead.lead?.contactPersonInfo || "",
                                siteAddress: lead.lead?.siteAddress || "",
                                customerAddress: lead.lead?.customerAddress || "",
                                status: lead.status || "",
                                quotationSentDate: q?.sentDate || null,
                                quotationId: q?._id || null,
                                grandTotalAfterGST: q?.grandTotalAfterGST || 0,
                                quotationFiles: q?.quotationFiles || [],
                                isCustomer: lead.isCustomer || false,
                                type: q.type || false,
                                createdAt: lead.createdAt,
                                updatedAt: q.updatedAt,
                            }));
                    }
                    // if quotation is still an object (legacy data)
                    else if (lead.quotation && typeof lead.quotation === "object") {
                        return {
                            leadId: lead._id,
                            companyName: lead.lead?.name || "",
                            contactPersonName: lead.lead?.contactPersonName || "",
                            contactPersonPhone: lead.lead?.contactPersonPhone || "",
                            contactPersonInfo: lead.lead?.contactPersonInfo || "",
                            siteAddress: lead.lead?.siteAddress || "",
                            customerAddress: lead.lead?.customerAddress || "",
                            status: lead.status || "",
                            quotationSentDate: lead.quotation?.sentDate || null,
                            quotationId: lead.quotation?._id || null,
                            grandTotalAfterGST: lead.quotation?.grandTotalAfterGST || 0,
                            quotationFiles: lead.quotation?.quotationFiles || [],
                            isCustomer: lead.isCustomer || false,
                            createdAt: lead.createdAt,
                            updatedAt: q.updatedAt,
                        };
                    } else {
                        return [];
                    }
                });
                // ✅ Sort quotations by their updatedAt (newest first)
                filteredLeads.sort((a, b) => {
                    const aDate = a.updatedAt ? new Date(a.updatedAt) : null;
                    const bDate = b.updatedAt ? new Date(b.updatedAt) : null;

                    if (aDate && bDate) {
                        return bDate - aDate;
                    } else if (aDate && !bDate) {
                        return -1;
                    } else if (!aDate && bDate) {
                        return 1;
                    } else {
                        return 0;
                    }
                });

            }

            // ✅ Apply search filter
            if (search.trim()) {
                const searchLower = search.toLowerCase();
                filteredLeads = filteredLeads.filter((lead) =>
                    Object.values({
                        companyName: lead.companyName,
                        contactPersonName: lead.contactPersonName,
                        contactPersonPhone: lead.contactPersonPhone,
                        contactPersonInfo: lead.contactPersonInfo,
                        siteAddress: lead.siteAddress,
                        customerAddress: lead.customerAddress,
                        status: lead.status,
                    })
                        .join(" ")
                        .toLowerCase()
                        .includes(searchLower)
                );
            }

            // ✅ Pagination (after filtering)
            const totalCount = filteredLeads.length;
            const startIndex = (page - 1) * limit;
            const paginatedLeads = filteredLeads.slice(
                startIndex,
                startIndex + parseInt(limit)
            );

            // ✅ Final response
            return res.status(200).json({
                success: true,
                message:
                    type === "paid"
                        ? "Paid leads fetched successfully"
                        : "Leads with quotation files fetched successfully",
                count: paginatedLeads.length,
                data: paginatedLeads,
                totalLeads,
                totalDefaulters,
                totalLegal,
                pagination: {
                    totalCount,
                    currentPage: Number(page),
                    totalPages: Math.ceil(totalCount / limit),
                },
            });
        } catch (error) {
            console.error("Show Data error:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // add Lead Alloted To
    // async addLeadAllotedTo(req, res) {
    //     try {
    //         const userId = req.user.id;
    //         const { leadId, userIds, message } = req.body; // userIds = array of user IDs

    //         // 1️⃣ Validate user
    //         const user = await User.findById(userId);
    //         if (!user) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: "User not found",
    //             });
    //         }

    //         // 2️⃣ Validate leadId
    //         if (!leadId) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: "Lead Id required to allot the Lead",
    //             });
    //         }

    //         // 3️⃣ Validate userIds array
    //         if (!Array.isArray(userIds) || userIds.length === 0) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: "User Ids must be a non-empty array",
    //             });
    //         }

    //         // 4️⃣ Find the lead
    //         const lead = await leadOrder.findById(leadId);
    //         if (!lead) {
    //             return res.status(404).json({
    //                 success: false,
    //                 message: "Lead not found",
    //             });
    //         }

    //         // 5️⃣ Add new users (prevent duplicates)
    //         const existingUserIds = lead.leadAllotedTo.map(
    //             (entry) => entry.user.toString()
    //         );

    //         const newUsers = userIds.filter(
    //             (uid) => !existingUserIds.includes(uid)
    //         );

    //         if (newUsers.length === 0) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: "All provided users are already allotted to this lead.",
    //             });
    //         }

    //         newUsers.forEach((uid) => {
    //             lead.leadAllotedTo.push({ user: uid });
    //         });

    //         await lead.save();

    //         return res.status(200).json({
    //             success: true,
    //             message: "Users successfully allotted to lead.",
    //             data: lead.leadAllotedTo,
    //         });
    //     } catch (error) {
    //         console.error("Server error:", error);
    //         res.status(500).json({
    //             success: false,
    //             message: "Server Error",
    //             error: error.message,
    //         });
    //     }
    // },
    async addLeadAllotedTo(req, res) {
        try {
            const actionUserId = req.user.id;
            const { leadId, assignments } = req.body;

            // ─────────────────────────────
            // Validate
            // ─────────────────────────────
            if (!leadId) {
                return res.status(400).json({
                    success: false,
                    message: "Lead ID is required",
                });
            }

            if (!Array.isArray(assignments) || assignments.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Assignments must be a non-empty array",
                });
            }

            const actionUser = await User.findById(actionUserId);
            if (!actionUser) {
                return res.status(404).json({
                    success: false,
                    message: "User not found",
                });
            }

            // ─────────────────────────────
            // Find Lead
            // ─────────────────────────────
            const lead = await leadOrder.findById(leadId);
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found",
                });
            }

            if (!Array.isArray(lead.leadAllotedTo)) {
                lead.leadAllotedTo = [];
            }

            // ─────────────────────────────
            // Fetch assigned user names (single query)
            // ─────────────────────────────
            const userIds = assignments.map(a => a.userId);

            const users = await User.find({
                _id: { $in: userIds }
            })
                .select("name email")
                .lean();

            const userMap = {};
            users.forEach(u => {
                userMap[u._id.toString()] = u.name;
            });

            // ─────────────────────────────
            // Apply Assignments + Timeline
            // ─────────────────────────────
            for (const a of assignments) {

                const assignedUserName =
                    userMap[a.userId] || "Unknown User";

                const existing = lead.leadAllotedTo.find(
                    entry => entry.user === a.userId
                );

                // CASE 1 → Existing user → Add message
                if (existing) {

                    existing.messages.push({
                        message: a.message || "",
                        createdAt: new Date(),
                    });

                    lead.timeline.push({
                        user: actionUserId,
                        changes: [
                            {
                                field: "leadAllotedTo.messages",
                                oldValue: assignedUserName,
                                newValue: `Message added: "${a.message || ""}"`,
                            },
                        ],
                        updatedAt: new Date(),
                    });

                }
                // CASE 2 → New user assigned
                else {

                    lead.leadAllotedTo.push({
                        user: a.userId,
                        messages: [
                            {
                                message: a.message || "",
                                createdAt: new Date(),
                            },
                        ],
                    });

                    lead.timeline.push({
                        user: actionUserId,
                        changes: [
                            {
                                field: "leadAllotedTo",
                                oldValue: "Not Assigned",
                                newValue: `Assigned to ${assignedUserName}`,
                            },
                        ],
                        updatedAt: new Date(),
                    });

                }
            }

            lead.markModified("leadAllotedTo");
            lead.markModified("timeline");

            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Lead allotments updated successfully.",
                data: lead.leadAllotedTo,
            });

        } catch (error) {
            console.error("Add Lead Allotment Error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // remove Lead Alloted To
    // async removeLeadAllotedTo(req, res) {
    //     try {  
    //         const userId = req.user.id;
    //         const { leadId, userIds } = req.body || {};

    //         // 1️⃣ Validate user
    //         const user = await User.findById(userId);
    //         if (!user) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: "User not found",
    //             });
    //         }

    //         // 2️⃣ Validate inputs
    //         if (!leadId) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: "Lead Id required",
    //             });
    //         }

    //         if (!userIds) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: "User Id required",
    //             });
    //         }

    //         // 3️⃣ Find and update the lead
    //         const lead = await leadOrder.findById(leadId);
    //         if (!lead) {
    //             return res.status(404).json({
    //                 success: false,
    //                 message: "Lead not found",
    //             });
    //         }

    //         // 4️⃣ Remove by user ID (string match)
    //         const beforeCount = lead.leadAllotedTo.length;
    //         lead.leadAllotedTo = lead.leadAllotedTo.filter(
    //             (entry) => entry.user !== userIds
    //         );

    //         if (lead.leadAllotedTo.length === beforeCount) {
    //             return res.status(404).json({
    //                 success: false,
    //                 message: "Alloted user not found in this lead",
    //             });
    //         }

    //         await lead.save();

    //         return res.status(200).json({
    //             success: true,
    //             message: "Alloted user removed successfully",
    //             data: lead.leadAllotedTo,
    //         });
    //     } catch (error) {
    //         console.error("Server error:", error);
    //         res.status(500).json({
    //             success: false,
    //             message: "Server Error",
    //             error: error.message,
    //         });
    //     }
    // },
    async removeLeadAllotedTo(req, res) {
        try {
            const userId = req.user.id;
            const { leadId, userIds, message } = req.body;

            if (!leadId) return res.status(400).json({ success: false, message: "Lead ID required" });
            if (!userIds || (Array.isArray(userIds) && userIds.length === 0))
                return res.status(400).json({ success: false, message: "User ID(s) required" });

            const user = await User.findById(userId);
            if (!user) return res.status(400).json({ success: false, message: "User not found" });

            const lead = await leadOrder.findById(leadId);
            if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

            const userIdsArray = Array.isArray(userIds) ? userIds : [userIds];

            const removedEntries = lead.leadAllotedTo.filter((entry) =>
                userIdsArray.includes(entry.user.toString())
            );

            if (removedEntries.length === 0)
                return res.status(404).json({ success: false, message: "No matching assigned users found" });

            // Remove users
            lead.leadAllotedTo = lead.leadAllotedTo.filter(
                (entry) => !userIdsArray.includes(entry.user.toString())
            );

            // Add timeline entries per removed user
            for (const removed of removedEntries) {
                const removedUser = await User.findById(removed.user).select("name email role");
                lead.timeline.push({
                    user: userId,
                    changes: [
                        {
                            field: "leadAllotedTo",
                            oldValue: `Assigned to ${removedUser?.name || removed.user}`,
                            newValue: message
                                ? `Removed with message: "${message}"`
                                : "Removed from allotment",
                        },
                    ],
                    updatedAt: new Date(),
                });
            }

            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Lead unassigned successfully.",
                data: lead.leadAllotedTo,
            });
        } catch (error) {
            console.error("Server error:", error);
            res.status(500).json({ success: false, message: "Server Error", error: error.message });
        }
    },

    // 🗑️ Delete a specific message from a user's lead assignment
    async deleteLeadMessage(req, res) {
        try {
            const actionUserId = req.user.id;
            const { leadId, userId, messageId } = req.body;

            if (!leadId || !userId || !messageId) {
                return res.status(400).json({
                    success: false,
                    message: "leadId, userId, and messageId are required",
                });
            }

            const lead = await leadOrder.findById(leadId);
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found",
                });
            }

            const assignedUser = lead.leadAllotedTo.find(
                entry => entry.user.toString() === userId
            );

            if (!assignedUser) {
                return res.status(404).json({
                    success: false,
                    message: "User not assigned to this lead",
                });
            }

            const msgIndex = assignedUser.messages.findIndex(
                msg => msg._id.toString() === messageId
            );

            if (msgIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message: "Message not found",
                });
            }

            const deletedMessage = assignedUser.messages[msgIndex];

            // Remove message
            assignedUser.messages.splice(msgIndex, 1);

            lead.markModified("leadAllotedTo");

            // Get assigned user name
            const assignedUserDoc = await User.findById(userId)
                .select("name")
                .lean();

            const assignedUserName =
                assignedUserDoc?.name || "Unknown User";

            // Timeline
            lead.timeline.push({
                user: actionUserId, // Actor
                changes: [
                    {
                        field: "leadAllotedTo.messages",
                        oldValue: `${assignedUserName}: "${deletedMessage.message}"`,
                        newValue: "Deleted",
                        targetUser: userId,
                        targetUserName: assignedUserName,
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("timeline");

            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Message deleted successfully",
            });

        } catch (error) {
            console.error("Delete Lead Message Error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // ✅ Add or Update Response to a Specific Message
    async addLeadMessageResponse(req, res) {
        try {
            const actionUserId = req.user.id;
            const { leadId, userId: assignedUserId, messageId, response } = req.body;

            // Validate
            if (!leadId || !assignedUserId || !messageId) {
                return res.status(400).json({
                    success: false,
                    message: "leadId, userId, and messageId are required",
                });
            }

            // Find Lead
            const lead = await leadOrder.findById(leadId);
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found",
                });
            }

            // Find Assigned User
            const assignedUser = lead.leadAllotedTo.find(
                (entry) => entry.user.toString() === assignedUserId
            );

            if (!assignedUser) {
                return res.status(404).json({
                    success: false,
                    message: "This user is not assigned to this lead",
                });
            }

            // Find Message
            const targetMessage = assignedUser.messages.find(
                (msg) => msg._id.toString() === messageId
            );

            if (!targetMessage) {
                return res.status(404).json({
                    success: false,
                    message: "Message not found for this user",
                });
            }

            // Get assigned user name
            const assignedUserDoc = await User.findById(assignedUserId)
                .select("name")
                .lean();

            const assignedUserName =
                assignedUserDoc?.name || "Unknown User";

            // Capture OLD response
            const oldResponse = targetMessage.response || "";

            // Update response
            targetMessage.response = response;

            if (!Array.isArray(lead.timeline)) {
                lead.timeline = [];
            }

            // Timeline
            lead.timeline.push({
                user: actionUserId,
                changes: [
                    !oldResponse
                        ? {
                            field: "leadAllotedTo.messageResponse",
                            oldValue: `${assignedUserName}: "${targetMessage.message}"`,
                            newValue: `Response added: "${response}"`,
                            targetUser: assignedUserId,
                            targetUserName: assignedUserName,
                        }
                        : {
                            field: "leadAllotedTo.messageResponse",
                            oldValue: `${assignedUserName} response: "${oldResponse}"`,
                            newValue: `Updated to: "${response}"`,
                            targetUser: assignedUserId,
                            targetUserName: assignedUserName,
                        },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("leadAllotedTo");
            lead.markModified("timeline");

            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Response added/updated successfully",
                data: targetMessage,
            });

        } catch (error) {
            console.error("Error adding response:", error);

            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // ✅ Update an existing message text inside leadAllotedTo
    async updateLeadMessage(req, res) {
        try {
            const actionUserId = req.user.id;
            const { leadId, assignedUserId, messageId, newMessage } = req.body;

            // Validate
            if (!leadId || !assignedUserId || !messageId || !newMessage) {
                return res.status(400).json({
                    success: false,
                    message:
                        "leadId, assignedUserId, messageId, and newMessage are required.",
                });
            }

            // Find Lead
            const lead = await leadOrder.findById(leadId);
            if (!lead) {
                return res.status(404).json({
                    success: false,
                    message: "Lead not found.",
                });
            }

            // Find Assigned User
            const assignedUser = lead.leadAllotedTo.find(
                (entry) => entry.user.toString() === assignedUserId
            );

            if (!assignedUser) {
                return res.status(404).json({
                    success: false,
                    message: "User not assigned to this lead.",
                });
            }

            // Find Message
            const targetMessage = assignedUser.messages.find(
                (msg) => msg._id.toString() === messageId
            );

            if (!targetMessage) {
                return res.status(404).json({
                    success: false,
                    message: "Message not found for this user.",
                });
            }

            // Get assigned user name
            const assignedUserDoc = await User.findById(assignedUserId)
                .select("name")
                .lean();

            const assignedUserName =
                assignedUserDoc?.name || "Unknown User";

            // Capture OLD value
            const oldMessage = targetMessage.message || "";

            // Update
            targetMessage.message = newMessage;

            if (!Array.isArray(lead.timeline)) {
                lead.timeline = [];
            }

            // Timeline
            lead.timeline.push({
                user: actionUserId,
                changes: [
                    {
                        field: "leadAllotedTo.message",
                        oldValue: `${assignedUserName}: "${oldMessage}"`,
                        newValue: `Updated to: "${newMessage}"`,
                        targetUser: assignedUserId,
                        targetUserName: assignedUserName,
                    },
                ],
                updatedAt: new Date(),
            });

            lead.markModified("leadAllotedTo");
            lead.markModified("timeline");

            await lead.save();

            return res.status(200).json({
                success: true,
                message: "Message updated successfully.",
                data: targetMessage,
            });

        } catch (error) {
            console.error("Error updating message:", error);

            res.status(500).json({
                success: false,
                message: "Server error.",
                error: error.message,
            });
        }
    },

    // ✅ Get Lead Names & IDs (Search + Pagination)
    async getLeadNamesAndId(req, res) {
        try {
            const userId = req.user.id;
            const user = await User.findById(userId);
            if (!user) return res.status(400).json({ success: false, message: "User not found" });
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
            const skip = (page - 1) * limit;

            const search = req.query.search?.trim() || "";

            // Build case-insensitive search filter
            const searchFilter = search
                ? { "lead.name": { $regex: search, $options: "i" } }
                : {};

            // 🔒 Role-based access filter
            let accessFilter = {};

            if (user.role?.toLowerCase() === "admin") {
                // 🟢 Admin → see all leads
                accessFilter = {};
            } else {
                // 🔒 Non-admin → see only leads where they are alloted
                accessFilter = { "leadAllotedTo.user": userId.toString() };
            }

            // 🧩 Combine filters
            const finalFilter = { $and: [searchFilter, accessFilter] };

            // Find only IDs & names
            const leads = await leadOrder
                .find(finalFilter)
                .select("lead.name _id")
                .sort({ "lead.name": 1 })
                .skip(skip)
                .limit(limit);

            const totalCount = await leadOrder.countDocuments(finalFilter);

            res.status(200).json({
                success: true,
                data: leads.map((l) => ({
                    _id: l._id,
                    name: l.lead.name,
                })),
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages: Math.ceil(totalCount / limit),
                },
            });
        } catch (error) {
            console.error("Error in getLeadNamesAndId:", error);
            res
                .status(500)
                .json({ success: false, message: "Server Error", error: error.message });
        }
    },

    // Get all the leads for the Admin
    // async getAllVisits(req, res) {
    //     try {
    //         const userId = req.user.id

    //         // Check user existence
    //         const user = await User.findById(userId);
    //         if (!user) {
    //             return res.status(404).json({ success: false, message: "User not found" });
    //         }

    //         // Pagination inputs
    //         const page = Math.max(1, parseInt(req.query.page) || 1);
    //         const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    //         const skip = (page - 1) * limit;

    //         // 🔍 Search filter
    //         const search = req.query.search?.trim() || "";
    //         let searchFilter = {};

    //         if (search) {
    //             const isNumericSearch = !isNaN(search);
    //             searchFilter = {
    //                 $or: [
    //                     { "visitCompanyName.name": { $regex: search, $options: "i" } },
    //                     { "visitCompanyName.enquiry": { $regex: search, $options: "i" } },
    //                     { "visitCompanyName.siteAddress": { $regex: search, $options: "i" } },
    //                     { "visitCompanyName.contactPersonInfo.contactPersonName": { $regex: search, $options: "i" } },
    //                     { "visitCompanyName.contactPersonInfo.contactPersonEmail": { $regex: search, $options: "i" } },
    //                     ...(isNumericSearch
    //                         ? [{ "visitCompanyName.contactPersonInfo.contactPersonPhone": Number(search) }]
    //                         : []),
    //                     { "remarks.note": { $regex: search, $options: "i" } },
    //                 ],
    //             };
    //         }

    //         // 🧑 Filter by addedBy if provided
    //         let addedByFilter = {};
    //         if (req.query.addedBy) {
    //             addedByFilter = { addedBy: req.query.addedBy };
    //         }

    //         // 🧮 Combine filters
    //         const combinedFilter = { ...searchFilter, ...addedByFilter };

    //         // 🔒 Role-based access control
    //         let accessFilter = {};
    //         if (user.role?.toLowerCase() !== "admin") {
    //             accessFilter = { addedBy: userId }; // non-admin users see only their own visits
    //         }

    //         const finalFilter = { ...combinedFilter, ...accessFilter };

    //         // 🧾 Fetch total and paginated results
    //         const [totalVisits, visits] = await Promise.all([
    //             VisitData.countDocuments(finalFilter),
    //             VisitData.find(finalFilter)
    //                 .populate("addedBy", "name email role")
    //                 .populate("companyName", "lead.name lead.contactPersonInfo lead.siteAddress lead.enquiry isCustomer")
    //                 .sort({ createdAt: -1 })
    //                 .skip(skip)
    //                 .limit(limit),
    //         ]);

    //         // 🧩 No data case
    //         if (!visits.length) {
    //             return res.status(200).json({
    //                 success: true,
    //                 message: "No visits found",
    //                 totalVisits,
    //                 page,
    //                 pages: 0,
    //                 data: [],
    //             });
    //         }

    //         // ✅ Success response
    //         res.status(200).json({
    //             success: true,
    //             count: visits.length,
    //             data: visits,
    //             totalLeads: totalVisits,
    //             pagination: {
    //                 page,
    //                 limit,
    //                 totalPages: Math.ceil(totalVisits / limit),
    //             },
    //         });

    //     } catch (error) {
    //         console.log("Server Error: ", error.message);
    //         res.status(500).json({
    //             success: false,
    //             message: "Internal Server Error",
    //             error: error.message
    //         })

    //     }
    // },
    // Get all the visits for the Admin (with alphaRange + date filters)
    async getAllVisits(req, res) {
        try {
            const userId = req.user.id;

            // 🧍 Verify user
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // 🔢 Pagination
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
            const skip = (page - 1) * limit;

            // 🧾 Filters
            const { search, addedBy, alphaRange, filterType, filterValue, from, to } = req.query;

            // 🧍 Access control
            const accessFilter =
                user.role?.toLowerCase() === "admin"
                    ? {}
                    : { addedBy: new mongoose.Types.ObjectId(userId) };

            const addedByFilter = addedBy
                ? { addedBy: new mongoose.Types.ObjectId(addedBy) }
                : {};

            // 📅 Date filter
            let dateFilter = {};
            if (from && to) {
                const start = new Date(from);
                const end = new Date(to);
                end.setHours(23, 59, 59, 999);
                dateFilter = { createdAt: { $gte: start, $lte: end } };
            } else if (filterType && filterValue) {
                const start = new Date(filterValue);
                let end = new Date(start);
                if (filterType === "date") end.setDate(start.getDate() + 1);
                else if (filterType === "month") end.setMonth(start.getMonth() + 1);
                else if (filterType === "year") end.setFullYear(start.getFullYear() + 1);
                dateFilter = { createdAt: { $gte: start, $lt: end } };
            }

            // 🔍 Build Lead Search Filter
            let leadMatchFilter = {};
            if (search?.trim() || alphaRange) {
                const term = search?.trim();
                const isNumeric = term && !isNaN(term);
                const leadSearch = [];

                if (term) {
                    leadSearch.push(
                        { "lead.name": { $regex: term, $options: "i" } },
                        { "lead.enquiry": { $regex: term, $options: "i" } },
                        { "lead.siteAddress": { $regex: term, $options: "i" } },
                        { "lead.contactPersonInfo.contactPersonName": { $regex: term, $options: "i" } },
                        { "lead.contactPersonInfo.contactPersonEmail": { $regex: term, $options: "i" } },
                        ...(isNumeric
                            ? [{ "lead.contactPersonInfo.contactPersonPhone": Number(term) }]
                            : [])
                    );
                }

                // 🅰️ Alpha Range for Lead
                if (alphaRange) {
                    const [start, end] = alphaRange.split("-").map(ch => ch.trim().toUpperCase());
                    const alphaRegex = start && end ? new RegExp(`^[${start}-${end}]`, "i") : /^[^A-Za-z]/;
                    leadSearch.push({ "lead.name": { $regex: alphaRegex } });
                }

                if (leadSearch.length > 0) {
                    leadMatchFilter = { $or: leadSearch };
                }
            }

            // 🧩 Get matching lead IDs
            let matchingLeadIds = [];
            if (Object.keys(leadMatchFilter).length > 0) {
                const matchingLeads = await leadOrder.find(leadMatchFilter).select("_id");
                matchingLeadIds = matchingLeads.map((l) => l._id);
            }

            // 🔍 VisitData Search Filter
            const visitSearchConditions = [];
            if (search?.trim()) {
                const term = search.trim();
                const isNumeric = !isNaN(term);

                visitSearchConditions.push(
                    { "visitCompanyName.name": { $regex: term, $options: "i" } },
                    { "visitCompanyName.enquiry": { $regex: term, $options: "i" } },
                    { "visitCompanyName.siteAddress": { $regex: term, $options: "i" } },
                    { "visitCompanyName.contactPersonInfo.contactPersonName": { $regex: term, $options: "i" } },
                    { "visitCompanyName.contactPersonInfo.contactPersonEmail": { $regex: term, $options: "i" } },
                    ...(isNumeric
                        ? [{ "visitCompanyName.contactPersonInfo.contactPersonPhone": Number(term) }]
                        : []),
                    { "remarks.note": { $regex: term, $options: "i" } }
                );
            }

            // 🅰️ Alpha Range (for VisitData)
            if (alphaRange) {
                const [start, end] = alphaRange.split("-").map(ch => ch.trim().toUpperCase());
                const alphaRegex = start && end ? new RegExp(`^[${start}-${end}]`, "i") : /^[^A-Za-z]/;
                visitSearchConditions.push({ "visitCompanyName.name": { $regex: alphaRegex } });
            }

            // Combine all conditions dynamically
            const orConditions = [];

            if (visitSearchConditions.length > 0) orConditions.push({ $or: visitSearchConditions });
            if (matchingLeadIds.length > 0) orConditions.push({ companyName: { $in: matchingLeadIds } });

            // 🧩 Final Query Filter
            const combinedFilter = {
                ...accessFilter,
                ...addedByFilter,
                ...dateFilter,
                ...(orConditions.length > 0 ? { $or: orConditions } : {}),
            };

            // 📦 Execute Query
            const [totalVisits, visits] = await Promise.all([
                VisitData.countDocuments(combinedFilter),
                VisitData.find(combinedFilter)
                    .populate("addedBy", "name email role")
                    .populate({
                        path: "companyName",
                        select: "lead.name lead.contactPersonInfo lead.enquiry lead.siteAddress isCustomer",
                    })
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit),
            ]);

            // ✅ Final Response
            return res.status(200).json({
                success: true,
                count: visits.length,
                data: visits,
                totalLeads: totalVisits,
                pagination: {
                    page,
                    limit,
                    totalPages: Math.ceil(totalVisits / limit),
                },
            });
        } catch (error) {
            console.error("Error in getAllVisits:", error);
            return res.status(500).json({
                success: false,
                message: "Internal Server Error",
                error: error.message,
            });
        }
    },

    // Create lead from the visit
    async createLeadFromVisit(req, res) {
        try {
            const adminId = req.user.id // assuming your auth middleware attaches req.user
            const { visitId } = req.params;

            // ✅ Find the visit
            const visit = await VisitData.findById(visitId);
            if (!visit) {
                return res.status(404).json({ success: false, message: "Visit not found." });
            }

            // ✅ Ensure this visit has `visitCompanyName`
            if (!visit.visitCompanyName || !visit.visitCompanyName.name || !visit.visitCompanyName.siteAddress) {
                return res.status(400).json({
                    success: false,
                    message: "This visit does not have valid 'visitCompanyName' details. Cannot create a lead.",
                });
            }

            // ✅ Check for existing lead with same name (case-insensitive)
            const existingLead = await leadOrder.findOne({
                "lead.name": { $regex: new RegExp(`^${visit.visitCompanyName.name}$`, "i") },
            });

            if (existingLead) {
                return res.status(400).json({
                    success: false,
                    message: `A lead with the company name "${visit.visitCompanyName.name}" already exists.`,
                });
            }


            // ✅ Prepare new lead data
            const newLeadData = {
                addedBy: visit?.addedBy || adminId,
                status: "Lead Generated",
                lead: {
                    name: visit.visitCompanyName.name,
                    enquiry: visit.visitCompanyName.enquiry || "",
                    siteAddress: visit.visitCompanyName.siteAddress || "",
                    contactPersonInfo: visit.visitCompanyName.contactPersonInfo?.length
                        ? visit.visitCompanyName.contactPersonInfo.map((p) => ({
                            contactPersonName: p.contactPersonName || "",
                            contactPersonEmail: p.contactPersonEmail || "",
                            contactPersonPhone: p.contactPersonPhone || [],
                        }))
                        : [],
                },
            };

            // ✅ Save the new Lead
            const lead = new leadOrder(newLeadData);
            await lead.save();

            // ✅ (Optional) Update visit to reference created lead
            visit.companyName = lead._id;
            await visit.save();

            return res.status(201).json({
                success: true,
                message: "Lead created successfully from visit.",
                data: lead,
            });
        } catch (error) {
            console.error("Error creating lead from visit:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while creating lead from visit.",
                error: error.message,
            });
        }
    },

    // Get the report of the lead and user from the condition with all the filters, search and pagination
    async getReport(req, res) {
        try {
            const userId = req.user?._id;
            if (!userId)
                return res.status(401).json({ success: false, message: "Unauthorized" });

            const currentUser = await User.findById(userId);
            if (!currentUser)
                return res.status(404).json({ success: false, message: "User not found" });

            const {
                type = "leads",
                search = "",
                selectedUser,
                selectedLead,
                filterType,
                filterValue,
                from,
                to,
                page = 1,
                limit = 10,
            } = req.query;

            const skip = (page - 1) * limit;
            const queryLimit = Math.min(parseInt(limit), 100);

            // 🕒 Build Date Filter
            let dateFilter = {};
            if (filterType) {
                let start, end;
                if (filterType === "date" && filterValue) {
                    const date = new Date(filterValue);
                    start = new Date(date.setHours(0, 0, 0, 0));
                    end = new Date(date.setHours(23, 59, 59, 999));
                } else if (filterType === "month" && filterValue) {
                    const [year, month] = filterValue.split("-");
                    start = new Date(year, month - 1, 1);
                    end = new Date(year, month, 0, 23, 59, 59, 999);
                } else if (filterType === "year" && filterValue) {
                    const year = parseInt(filterValue);
                    start = new Date(year, 0, 1);
                    end = new Date(year, 11, 31, 23, 59, 59, 999);
                } else if (filterType === "range" && from && to) {
                    start = new Date(from);
                    end = new Date(to);
                    end.setHours(23, 59, 59, 999);
                }
                if (start && end)
                    dateFilter = { "timeline.updatedAt": { $gte: start, $lte: end } };
            }

            // ────────────────────────────────────────────────
            // TYPE: LEADS REPORT
            // ────────────────────────────────────────────────
            if (type === "leads") {
                const query = { ...dateFilter };

                // 🔍 Search filter
                if (search) {
                    const regex = new RegExp(search, "i");
                    query["lead.name"] = regex;
                }

                // 🎯 Filter by selected lead
                if (selectedLead) {
                    query["lead.name"] = selectedLead;
                }

                // 👤 Filter by selected user (in timeline)
                if (selectedUser) {
                    const matchedUser = await User.findOne({ name: selectedUser });
                    if (matchedUser) {
                        query["timeline.user"] = matchedUser._id;
                    }
                }

                const leads = await leadOrder
                    .find(query)
                    .populate("addedBy", "name email role")
                    .populate("timeline.user", "name email role")
                    .populate("leadAllotedTo.user", "name email role")
                    .sort({ updatedAt: -1 })
                    .skip(skip)
                    .limit(queryLimit);

                const total = await leadOrder.countDocuments(query);

                const formatted = await Promise.all(
                    leads.map(async (lead) => {
                        let assignedToDisplay = "Not assigned to user";

                        if (lead.leadAllotedTo && lead.leadAllotedTo.length > 0) {
                            const userIds = lead.leadAllotedTo.map((x) => x.user).filter(Boolean);
                            const assignedUsers = await User.find({ _id: { $in: userIds } }).select("name role");

                            assignedToDisplay = userIds
                                .map((uid) => {
                                    const user = assignedUsers.find((u) => u._id.toString() === uid);
                                    return user ? `${user.name} (${user.role || "N/A"})` : uid;
                                })
                                .join(", ");
                        }

                        // ✅ Sort timeline by updatedAt (latest first)
                        let sortedTimeline = [];
                        if (Array.isArray(lead.timeline)) {
                            sortedTimeline = [...lead.timeline].sort(
                                (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
                            );
                        }

                        return {
                            leadId: lead._id,
                            leadName: lead.lead?.name || "Unnamed Lead",
                            createdBy: lead.addedBy?.name || "Unknown",
                            role: lead.addedBy?.role || "Unknown",
                            createdAt: lead.createdAt || "Unknown",
                            assignedTo: assignedToDisplay,
                            timeline: sortedTimeline, // 👈 same as getLeadById (no flattening or merging)
                        };
                    })
                );

                return res.status(200).json({
                    success: true,
                    type: "leads",
                    total,
                    totalPages: Math.ceil(total / queryLimit),
                    data: formatted,
                });
            }


            // ────────────────────────────────────────────────
            // TYPE: USERS REPORT – Chronological change list per user (no grouping by lead)
            // ────────────────────────────────────────────────
            else if (type === "users") {
                const timelineQuery = { ...dateFilter };
                const { changeField } = req.query; // optional filter by specific field

                // 🎯 Filter by selected lead
                if (selectedLead) {
                    const leadDocs = await leadOrder
                        .find({ "lead.name": selectedLead })
                        .select("_id");
                    timelineQuery._id = { $in: leadDocs.map((l) => l._id) };
                }

                const leads = await leadOrder
                    .find(timelineQuery)
                    .populate("timeline.user", "name email role")
                    .populate("addedBy", "name role")
                    .populate("leadAllotedTo.user", "name role");

                // 🔹 Fetch all leads for stats calculation
                const allLeads = await leadOrder.find({}).select(
                    "addedBy status isCustomer leadAllotedTo"
                );

                // 🧩 Aggregate all changes per user
                const userMap = {};

                for (const lead of leads) {
                    for (const t of lead.timeline || []) {
                        if (!t.user) continue;

                        const userId = t.user._id || t.user.id;
                        const userName = t.user.name;
                        const userEmail = t.user.email;
                        const userRole = t.user.role || "N/A";

                        if (!userMap[userName]) {
                            userMap[userName] = {
                                _id: userId,
                                user: userName,
                                email: userEmail,
                                role: userRole,
                                leadsWorkedOn: [],
                                stats: {},
                            };
                        }

                        // Add timeline changes
                        (t.changes || []).forEach((c) => {
                            if (changeField && c.field !== changeField) return;
                            userMap[userName].leadsWorkedOn.push({
                                leadName: lead.lead?.name || "Unnamed Lead",
                                field: c.field,
                                changeSummary: `${c.oldValue || "—"} → ${c.newValue || "—"}`,
                                updatedAt: t.updatedAt,
                            });
                        });

                        // 🔹 Calculate stats for this user
                        const userLeads = allLeads.filter(
                            (l) => l.addedBy?.toString() === t.user._id.toString()
                        );
                        const totalLeads = userLeads.length;
                        const totalDefaulters = userLeads.filter(
                            (l) => l.status === "Marked Defaulter"
                        ).length;
                        const totalComplete = userLeads.filter(
                            (l) => l.status === "Marked Complete"
                        ).length;
                        const totalDiscard = userLeads.filter(
                            (l) => l.status === "Marked Discard"
                        ).length;
                        const totalLegal = userLeads.filter(
                            (l) => l.status === "Marked Legal"
                        ).length;
                        const totalCustomers = userLeads.filter((l) => l.isCustomer).length;

                        const totalAllotedToUser = allLeads.filter((l) =>
                            (l.leadAllotedTo || []).some(
                                (a) => a.user?.toString() === t.user._id.toString()
                            )
                        ).length;

                        const totalAlloted = userLeads.filter(
                            (l) => Array.isArray(l.leadAllotedTo) && l.leadAllotedTo.length > 0
                        ).length;

                        userMap[userName].stats = {
                            totalLeads,
                            totalDefaulters,
                            totalComplete,
                            totalDiscard,
                            totalLegal,
                            totalCustomers,
                            totalAllotedToUser,
                            totalAlloted,
                        };
                    }
                }

                // 🧠 Sort each user's changes chronologically (latest first)
                let usersArray = Object.values(userMap)
                    .filter((u) => u.leadsWorkedOn.length > 0)
                    .map((u) => {
                        const sorted = [...u.leadsWorkedOn].sort(
                            (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
                        );
                        return { ...u, leadsWorkedOn: sorted, stats: u.stats || {} };
                    });

                // 🔍 Text search by name/email
                if (search) {
                    const regex = new RegExp(search, "i");
                    usersArray = usersArray.filter(
                        (u) => regex.test(u.user) || regex.test(u.email)
                    );
                }

                // 🎯 Filter by selected user
                if (selectedUser) {
                    usersArray = usersArray.filter((u) => u.user === selectedUser);
                }

                const total = usersArray.length;
                const paginated = usersArray.slice(skip, skip + queryLimit);

                return res.status(200).json({
                    success: true,
                    type: "users",
                    total,
                    totalPages: Math.ceil(total / queryLimit),
                    data: paginated,
                });
            }



            return res.status(400).json({
                success: false,
                message: "Invalid report type. Use ?type=leads or ?type=users",
            });
        } catch (error) {
            console.error("Error getting report:", error);
            res.status(500).json({
                success: false,
                message: "Server error while getting the report",
                error: error.message,
            });
        }
    },

    // get user report stats
    async getUserReportStats(req, res) {
        try {
            const adminId = req.user?._id;
            if (!adminId)
                return res.status(401).json({ success: false, message: "Unauthorized" });

            const currentUser = await User.findById(adminId);
            if (!currentUser)
                return res.status(404).json({ success: false, message: "User not found" });

            if (currentUser.role !== "Admin")
                return res.status(403).json({
                    success: false,
                    message: "Access denied, only admin allowed",
                });

            // get params from body
            const { type, userId } = req.body || {};
            if (!type || !userId)
                return res.status(400).json({
                    success: false,
                    message: "Type and userId are required",
                });

            // Define filter based on type
            let filter = {};
            switch (type) {
                case "leads":
                    filter = { addedBy: userId };
                    break;
                case "customer":
                    filter = { addedBy: userId, isCustomer: true };
                    break;
                case "complete":
                    filter = { addedBy: userId, status: "Marked Complete" };
                    break;
                case "discard":
                    filter = { addedBy: userId, status: "Marked Discard" };
                    break;
                case "defaulter":
                    filter = { addedBy: userId, status: "Marked Defaulter" };
                    break;
                case "legal":
                    filter = { addedBy: userId, status: "Marked Legal" };
                    break;
                case "allotedBy":
                    filter = { addedBy: userId, leadAllotedTo: { $ne: [] } };
                    break;
                case "allotedTo":
                    filter = { "leadAllotedTo.user": userId };
                    break;
                case "pendingLeads":
                    filter = {
                        addedBy: userId,
                        isCustomer: false,
                        leadAllotedTo: { $size: 0 },
                        status: {
                            $nin: [
                                "Marked Defaulter",
                                "Marked Discard",
                                "Marked Complete",
                                "Marked Legal",
                            ],
                        },
                        $and: [
                            { leadFollowUps: { $size: 0 } },
                            { "quotation.followUps": { $size: 0 } },
                            { "billing.followUps": { $size: 0 } },
                            { "payment.followUps": { $size: 0 } },
                            { "legal.followUps": { $size: 0 } },
                        ],
                    };
                    break;
                default:
                    return res.status(400).json({
                        success: false,
                        message: "Invalid type value",
                    });
            }

            // Conditional projection
            const projection = "lead status isCustomer createdAt timeline leadAllotedTo";

            // Fetch leads for selected type
            let leads = await leadOrder
                .find(filter, projection)
                .populate({ path: "lead", select: "name siteAddress -_id" })
                .populate({
                    path: "leadAllotedTo.user",
                    model: "User",
                    select: "name role -_id",
                })
                .populate({
                    path: "timeline.user",
                    model: "User",
                    select: "name role -_id",
                })
                .lean();

            // Attach latest timeline
            leads = leads.map((lead) => ({
                ...lead,
                latestTimeline:
                    Array.isArray(lead.timeline) && lead.timeline.length > 0
                        ? lead.timeline[lead.timeline.length - 1]
                        : null,
            }));

            // Remove full timeline
            leads = leads.map(({ timeline, ...rest }) => rest);

            // ────────────────────────────────────────────────
            // ✅ Calculate Stats (All Totals)
            // ────────────────────────────────────────────────
            const [
                totalLeads,
                totalCustomers,
                totalComplete,
                totalDiscard,
                totalDefaulters,
                totalLegal,
                totalAllotedToUser,
                totalAlloted,
                totalPendingLeads,
            ] = await Promise.all([
                leadOrder.countDocuments({ addedBy: userId }),
                leadOrder.countDocuments({ addedBy: userId, isCustomer: true }),
                leadOrder.countDocuments({ addedBy: userId, status: "Marked Complete" }),
                leadOrder.countDocuments({ addedBy: userId, status: "Marked Discard" }),
                leadOrder.countDocuments({ addedBy: userId, status: "Marked Defaulter" }),
                leadOrder.countDocuments({ addedBy: userId, status: "Marked Legal" }),
                leadOrder.countDocuments({ "leadAllotedTo.user": userId }),
                leadOrder.countDocuments({ addedBy: userId, leadAllotedTo: { $ne: [] } }),
                leadOrder.countDocuments({
                    addedBy: userId,
                    isCustomer: false,
                    leadAllotedTo: { $size: 0 },
                    status: {
                        $nin: [
                            "Marked Defaulter",
                            "Marked Discard",
                            "Marked Complete",
                            "Marked Legal",
                        ],
                    },
                    $and: [
                        { leadFollowUps: { $size: 0 } },
                        { "quotation.followUps": { $size: 0 } },
                        { "billing.followUps": { $size: 0 } },
                        { "payment.followUps": { $size: 0 } },
                        { "legal.followUps": { $size: 0 } },
                    ],
                }),
            ]);

            const stats = {
                totalLeads,
                totalCustomers,
                totalComplete,
                totalDiscard,
                totalDefaulters,
                totalLegal,
                totalAllotedToUser,
                totalAlloted,
                totalPendingLeads,
            };

            // ✅ Response
            return res.status(200).json({
                success: true,
                message: `User ${type} data fetched successfully`,
                type,
                count: leads.length,
                stats,
                data: leads,
            });
        } catch (error) {
            console.error("Error getting user stats report:", error);
            res.status(500).json({
                success: false,
                message: "Server error while getting the user stats report",
                error: error.message,
            });
        }
    },

    // ****************************************************************QUOTATION ITEMS API's**************************************************************************
    // create Quotation Items
    async createQuotation(req, res) {
        try {
            const userId = req.user._id; // from auth middleware
            const { items } = req.body; // items should be an array

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, message: "Items array is required" });
            }

            // Prepare array of documents to insert
            const newQuotations = items.map(item => ({
                addedBy: req.user._id, // from auth middleware
                items: {
                    name: item.name,
                    size: item.size || []
                }
            }));

            const createdQuotations = await QuotationItem.insertMany(newQuotations);

            res.status(201).json({ success: true, message: "Quoation Item added successfully", data: createdQuotations });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Server Error',
                error: error.message,
            });
        }
    },

    // get Quotation Items
    async getQuotation(req, res) {
        try {
            const userId = req.user._id; // from auth middleware

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const quotationItems = await QuotationItem.find()
                .populate("addedBy", "name email")
                .populate("timeline.user", "name email")
                .sort({ createdAt: -1 });

            // Sort each quotation's timeline by updatedAt descending (latest first)
            const quotationItemsWithSortedTimeline = quotationItems.map(item => {
                const sortedTimeline = item.timeline
                    ? [...item.timeline].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
                    : [];
                return { ...item.toObject(), timeline: sortedTimeline };
            });

            res.status(200).json({
                success: true,
                count: quotationItems.length,
                data: quotationItemsWithSortedTimeline,
            });

        } catch (error) {
            console.error("Error in getQuotation:", error);
            res.status(500).json({ success: false, message: "Server Error", error: error.message });
        }
    },

    // update Quotation Items
    async updateQuotation(req, res) {
        try {
            const userId = req.user._id; // from auth middleware
            const { id } = req.params;
            const { name, size } = req.body;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const quotation = await QuotationItem.findById(id);
            if (!quotation) {
                return res.status(404).json({ success: false, message: "Quotation not found" });
            }

            // Track changes in timeline
            const changes = [];
            if (name && name !== quotation.items.name) {
                changes.push({ field: "name", oldValue: quotation.items.name, newValue: name });
                quotation.items.name = name;
            }
            if (size && JSON.stringify(size) !== JSON.stringify(quotation.items.size)) {
                changes.push({ field: "size", oldValue: JSON.stringify(quotation.items.size), newValue: JSON.stringify(size) });
                quotation.items.size = size;
            }

            if (changes.length > 0) {
                quotation.timeline.push({ user: req.user._id, changes });
            }

            await quotation.save();
            res.status(200).json({ success: true, message: "Quotation item updated", data: quotation });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Server Error',
                error: error.message,
            });
        }
    },

    // delete Quotation Items
    async deleteQuotation(req, res) {
        try {
            const userId = req.user._id; // from auth middleware
            const { id } = req.params;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const quotationItem = await QuotationItem.findByIdAndDelete(id);
            if (!quotationItem) {
                return res.status(404).json({ success: false, message: "Quotation item not found" });
            }

            res.status(200).json({ success: true, message: "Quotation item deleted" });
        } catch (error) {
            res.status(500).json({ success: false, message: "Server Error", error: error.message });
        }
    },

    // ****************************************************************TERMS & CONDITIONS API's**************************************************************************
    // add Terms & Condition Items
    async addTermCondition(req, res) {
        try {
            const userId = req.user._id; // from auth middleware
            const { list } = req.body; // Expecting array of strings

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            if (!list || !Array.isArray(list) || list.length === 0) {
                return res.status(400).json({ success: false, message: "TERMS & CONDITIONS must be a non-empty array" });
            }

            // Create multiple records individually
            const createdTerms = await Promise.all(
                list.map(async (item) => {
                    return await TermCondition.create({ list: item });
                })
            );

            res.status(201).json({
                success: true,
                message: "TERMS & CONDITIONS added successfully",
                data: createdTerms,
            });
        } catch (error) {
            console.error("Error adding Terms & Conditions:", error);
            res.status(500).json({
                success: false,
                message: "TERMS & CONDITIONS Server Error",
                error: error.message,
            });
        }
    },

    // Get all Terms & Conditions
    async getAllTermConditions(req, res) {
        try {
            const userId = req.user._id;
            const user = await User.findById(userId);

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const terms = await TermCondition.find().sort({ createdAt: -1 });
            res.status(200).json({
                success: true,
                message: "TERMS & CONDITIONS fetched successfully",
                data: terms,
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Failed to fetch TERMS & CONDITIONS",
                error: error.message,
            });
        }
    },

    // Update a specific Term & Condition by ID
    async updateTermCondition(req, res) {
        try {
            const userId = req.user._id;
            const user = await User.findById(userId);

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const { id } = req.params;
            const { list } = req.body;

            if (!list) {
                return res.status(400).json({ success: false, message: "TERMS & CONDITIONS text is required" });
            }

            const updatedTerm = await TermCondition.findByIdAndUpdate(
                id,
                { list },
                { new: true }
            );

            if (!updatedTerm) {
                return res.status(404).json({ success: false, message: "Term & Condition not found" });
            }

            res.status(200).json({
                success: true,
                message: "Term & Condition updated successfully",
                data: updatedTerm,
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Failed to update TERM & CONDITION",
                error: error.message,
            });
        }
    },

    // Delete a specific Term & Condition by ID
    async deleteTermCondition(req, res) {
        try {
            const userId = req.user._id;
            const user = await User.findById(userId);

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const { id } = req.params;

            const deletedTerm = await TermCondition.findByIdAndDelete(id);

            if (!deletedTerm) {
                return res.status(404).json({ success: false, message: "Term & Condition not found" });
            }

            res.status(200).json({
                success: true,
                message: "Term & Condition deleted successfully",
                data: deletedTerm,
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Failed to delete TERM & CONDITION",
                error: error.message,
            });
        }
    },

    // ****************************************************************UNITS API's**************************************************************************
    // ✅ Create Units
    async createUnits(req, res) {
        try {
            const userId = req.user._id;
            const { units } = req.body;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            if (!units || !Array.isArray(units) || units.length === 0) {
                return res.status(400).json({ success: false, message: "Units array is required" });
            }

            const newUnits = units.map(unit => ({
                addedBy: userId,
                units: unit
            }));

            const createdUnits = await Units.insertMany(newUnits);

            res.status(201).json({
                success: true,
                message: "Units added successfully",
                data: createdUnits
            });
        } catch (error) {
            console.error("Error in createUnits:", error);
            res.status(500).json({ success: false, message: "Server Error", error: error.message });
        }
    },

    // ✅ Get All Units
    async getUnits(req, res) {
        try {
            const userId = req.user._id;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const unitsList = await Units.find()
                .populate("addedBy", "name email")
                .populate("timeline.user", "name email")
                .sort({ createdAt: -1 });

            const unitsWithSortedTimeline = unitsList.map(item => {
                const sortedTimeline = item.timeline
                    ? [...item.timeline].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
                    : [];
                return { ...item.toObject(), timeline: sortedTimeline };
            });

            res.status(200).json({
                success: true,
                count: unitsList.length,
                data: unitsWithSortedTimeline
            });
        } catch (error) {
            console.error("Error in getUnits:", error);
            res.status(500).json({ success: false, message: "Server Error", error: error.message });
        }
    },

    // ✅ Update Unit
    async updateUnit(req, res) {
        try {
            const userId = req.user._id;
            const { id } = req.params;
            const { units } = req.body;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const unit = await Units.findById(id);
            if (!unit) {
                return res.status(404).json({ success: false, message: "Unit not found" });
            }

            const changes = [];
            if (units && units !== unit.units) {
                changes.push({ field: "units", oldValue: unit.units, newValue: units });
                unit.units = units;
            }

            if (changes.length > 0) {
                unit.timeline.push({ user: userId, changes });
            }

            await unit.save();

            res.status(200).json({ success: true, message: "Unit updated successfully", data: unit });
        } catch (error) {
            console.error("Error in updateUnit:", error);
            res.status(500).json({ success: false, message: "Server Error", error: error.message });
        }
    },

    // ✅ Delete Unit
    async deleteUnit(req, res) {
        try {
            const userId = req.user._id;
            const { id } = req.params;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const deletedUnit = await Units.findByIdAndDelete(id);
            if (!deletedUnit) {
                return res.status(404).json({ success: false, message: "Unit not found" });
            }

            res.status(200).json({ success: true, message: "Unit deleted successfully" });
        } catch (error) {
            console.error("Error in deleteUnit:", error);
            res.status(500).json({ success: false, message: "Server Error", error: error.message });
        }
    },

    // ****************************************************************SOURCES API's**************************************************************************
    // ✅ Create Sources
    async createSources(req, res) {
        try {
            const userId = req.user._id;
            const { sourceName, referenceName } = req.body;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            if (
                !sourceName ||
                !Array.isArray(sourceName) ||
                sourceName.length === 0
            ) {
                return res.status(400).json({ success: false, message: "sourceName array is required" });
            }

            // if (
            //     !referenceName ||
            //     !Array.isArray(referenceName) ||
            //     referenceName.length === 0
            // ) {
            //     return res.status(400).json({ success: false, message: "referenceName array is required" });
            // }

            const newSource = new Sources({
                addedBy: userId,
                sourceName,
                // referenceName
            });

            const createdSource = await newSource.save();

            res.status(201).json({
                success: true,
                message: "Source added successfully",
                data: createdSource,
            });
        } catch (error) {
            console.error("Error in createSources:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // ✅ Get All Sources
    async getSources(req, res) {
        try {
            const userId = req.user._id;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const sourcesList = await Sources.find()
                .populate("addedBy", "name email")
                .populate("timeline.user", "name email")
                .sort({ createdAt: -1 });

            const sourcesWithSortedTimeline = sourcesList.map((item) => {
                const sortedTimeline = item.timeline
                    ? [...item.timeline].sort(
                        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
                    )
                    : [];
                return { ...item.toObject(), timeline: sortedTimeline };
            });

            res.status(200).json({
                success: true,
                count: sourcesList.length,
                data: sourcesWithSortedTimeline,
            });
        } catch (error) {
            console.error("Error in getSources:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // ✅ Update Source
    async updateSource(req, res) {
        try {
            const userId = req.user._id;
            const { id } = req.params;
            const { sourceName, referenceName } = req.body;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const source = await Sources.findById(id);
            if (!source) {
                return res.status(404).json({ success: false, message: "Source not found" });
            }

            const changes = [];

            // Compare and update sourceName
            if (sourceName && JSON.stringify(sourceName) !== JSON.stringify(source.sourceName)) {
                changes.push({
                    field: "sourceName",
                    oldValue: source.sourceName.join(", "),
                    newValue: sourceName.join(", "),
                });
                source.sourceName = sourceName;
            }

            // Compare and update referenceName
            // if (referenceName && JSON.stringify(referenceName) !== JSON.stringify(source.referenceName)) {
            //     changes.push({
            //         field: "referenceName",
            //         oldValue: source.referenceName.join(", "),
            //         newValue: referenceName.join(", "),
            //     });
            //     source.referenceName = referenceName;
            // }

            if (changes.length > 0) {
                source.timeline.push({ user: userId, changes });
            }

            await source.save();

            res.status(200).json({
                success: true,
                message: "Source updated successfully",
                data: source,
            });
        } catch (error) {
            console.error("Error in updateSource:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // ✅ Delete Source
    async deleteSource(req, res) {
        try {
            const userId = req.user._id;
            const { id } = req.params;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            const deletedSource = await Sources.findByIdAndDelete(id);
            if (!deletedSource) {
                return res.status(404).json({ success: false, message: "Source not found" });
            }

            res.status(200).json({
                success: true,
                message: "Source deleted successfully",
            });
        } catch (error) {
            console.error("Error in deleteSource:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message,
            });
        }
    },

    // ****************************************************************TASKS ASSIGNED API's**************************************************************************
    // ✅ Create Task(s) Assigned
    async createTaskAssigned(req, res) {
        try {
            // The user who is performing the action (must be Admin)
            const adminUserId = req.user._id;
            const adminUser = await User.findById(adminUserId);

            if (!adminUser || adminUser.role !== "Admin") {
                return res.status(403).json({
                    success: false,
                    message: "Access denied. Only Admins can assign tasks to users."
                });
            }

            // The target user to whom tasks are being assigned
            const { userID } = req.params;
            if (!userID) {
                return res.status(400).json({
                    success: false,
                    message: "userID parameter is required."
                });
            }

            const targetUser = await User.findById(userID);
            if (!targetUser) {
                return res.status(404).json({
                    success: false,
                    message: "Target user not found."
                });
            }

            // Prevent assigning tasks to self unnecessarily, or allow it — up to you
            // Optional: if (targetUser._id.toString() === adminUserId.toString()) { ... }

            const { tasks } = req.body;

            if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Tasks array is required and must contain at least one task."
                });
            }

            // Validate each task has a 'task' field
            for (const t of tasks) {
                if (!t.task || typeof t.task !== "string" || t.task.trim() === "") {
                    return res.status(400).json({
                        success: false,
                        message: "Each task must have a valid 'task' string."
                    });
                }
            }

            const newTasks = tasks.map((t) => ({
                task: t.task.trim(),
                response: t.response?.trim() || "",
                createdAt: new Date(),
                createdBy: adminUserId, // Optional: track who assigned the task
            }));

            targetUser.taskAssigned.push(...newTasks);
            await targetUser.save();

            res.status(200).json({
                success: true,
                message: `Tasks successfully assigned to ${targetUser.name || targetUser.email}`,
                data: targetUser.taskAssigned,
                assignedTo: {
                    userId: targetUser._id,
                    name: targetUser.name,
                    email: targetUser.email
                }
            });
        } catch (error) {
            console.error("Error in createTaskAssigned:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }
    },

    // ✅ Get All TaskAssigned for a User or by Task ID
    async getTaskAssignedByID(req, res) {
        try {
            // ✅ 1. Auth check
            const userId = req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "User not found" });
            }

            // ✅ 2. Fetch user
            const user = await User.findById(userId).select("name email taskAssigned");
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // ✅ 3. Pagination setup
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
            const skip = (page - 1) * limit;

            // ✅ 4. Search filter
            const search = req.query.search?.trim() || "";
            let filteredTasks = [...user.taskAssigned];

            if (search) {
                const searchRegex = new RegExp(search, "i");
                filteredTasks = filteredTasks.filter(
                    (t) =>
                        searchRegex.test(t.task) ||
                        searchRegex.test(t.response) ||
                        searchRegex.test(t._id?.toString())
                );
            }

            // ✅ 5. Optional taskId filter
            const { taskId } = req.query;
            if (taskId) {
                filteredTasks = filteredTasks.filter((t) => t._id.toString() === taskId);
            }

            // ✅ 6. Sort by created date (latest first)
            filteredTasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // ✅ 7. Apply pagination
            const paginatedTasks = filteredTasks.slice(skip, skip + limit);

            // ✅ 8. Handle empty result
            if (paginatedTasks.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: "No tasks found for this user",
                    total: 0,
                    page,
                    pages: 0,
                    data: [],
                });
            }

            // ✅ 9. Send structured response
            res.status(200).json({
                success: true,
                count: paginatedTasks.length,
                data: paginatedTasks,
                pagination: {
                    page,
                    limit,
                    totalTasks: filteredTasks.length,
                    totalPages: Math.ceil(filteredTasks.length / limit),
                },
            });
        } catch (error) {
            console.error("Error in getTaskAssignedByID:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message,
            });
        }
    },

    // ✅ Update TaskAssigned
    async updateAssignedTask(req, res) {
        try {
            // Authenticated user performing the action (must be Admin)
            const adminUserId = req.user._id;
            const adminUser = await User.findById(adminUserId);

            // Parameters: target user and task ID
            const { userID, taskId } = req.params;

            if (!userID) {
                return res.status(400).json({
                    success: false,
                    message: "userID parameter is required."
                });
            }

            if (!taskId) {
                return res.status(400).json({
                    success: false,
                    message: "taskId parameter is required."
                });
            }

            // Request body: optional fields to update
            const { task, response } = req.body;

            if (task === undefined && response === undefined) {
                return res.status(400).json({
                    success: false,
                    message: "At least one field (task or response) must be provided to update."
                });
            }

            // Find the target user
            const targetUser = await User.findById(userID);
            if (!targetUser) {
                return res.status(404).json({
                    success: false,
                    message: "Target user not found."
                });
            }

            // Find the specific task in taskAssigned array
            const taskItem = targetUser.taskAssigned.id(taskId);
            if (!taskItem) {
                return res.status(404).json({
                    success: false,
                    message: "Task not found for this user."
                });
            }

            // Track changes for audit/log purposes
            const changes = [];

            if (task !== undefined && task !== taskItem.task) {
                changes.push({
                    field: "task",
                    oldValue: taskItem.task,
                    newValue: task
                });
                taskItem.task = task.trim();
            }

            if (response !== undefined && response !== taskItem.response) {
                changes.push({
                    field: "response",
                    oldValue: taskItem.response,
                    newValue: response
                });
                taskItem.response = response ? response.trim() : "";
            }

            // Update timestamp
            taskItem.updatedAt = new Date();

            await targetUser.save();

            res.status(200).json({
                success: true,
                message: "Task updated successfully",
                data: taskItem,
                changes,
                updatedFor: {
                    userId: targetUser._id,
                    name: targetUser.name || targetUser.email
                }
            });
        } catch (error) {
            console.error("Error in updateAssignedTask:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }
    },

    // ✅ Delete Assigned Task
    async deleteAssignedTask(req, res) {
        try {
            // The authenticated user (must be Admin)
            const adminUserId = req.user._id;
            const adminUser = await User.findById(adminUserId);

            if (!adminUser || adminUser.role !== "Admin") {
                return res.status(403).json({
                    success: false,
                    message: "Access denied. Only Admins can delete tasks from users."
                });
            }

            // Target user ID from params
            const { userID, taskId } = req.params;

            if (!userID) {
                return res.status(400).json({
                    success: false,
                    message: "userID parameter is required."
                });
            }

            if (!taskId) {
                return res.status(400).json({
                    success: false,
                    message: "taskId parameter is required."
                });
            }

            // Find the target user whose task is being deleted
            const targetUser = await User.findById(userID);
            if (!targetUser) {
                return res.status(404).json({
                    success: false,
                    message: "Target user not found."
                });
            }

            // Find the specific task in the user's taskAssigned array
            const task = targetUser.taskAssigned.id(taskId);
            if (!task) {
                return res.status(404).json({
                    success: false,
                    message: "Task not found for this user."
                });
            }

            // Remove the task (subdocument)
            task.deleteOne();
            await targetUser.save();

            res.status(200).json({
                success: true,
                message: "Task deleted successfully",
                data: {
                    deletedTaskId: taskId,
                    fromUser: {
                        userId: targetUser._id,
                        name: targetUser.name || targetUser.email
                    }
                }
            });
        } catch (error) {
            console.error("Error in deleteAssignedTask:", error);
            res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }
    },
};

module.exports = userController;
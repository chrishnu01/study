const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

// ✅ Define a sub-schema for tasks
const taskSchema = new mongoose.Schema(
  {
    task: {
      type: String,
      required: true, // typable task name
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    response: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: true, // ✅ automatically adds an _id field for each task
  }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      minlength: 3,
      maxlength: 30,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      minLength: 10,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      minLength: 6,
    },
    role: {
      type: String,
      required: true,
    },
    isEditable: {
      type: Boolean,
      default: false,
    },
    isDeletable: {
      type: Boolean,
      default: false,
    },
    isAppLogin: {
      type: Boolean,
      default: false,
    },
    isCustomerView: {
      type: Boolean,
      default: true,
    },
    isVisitView: {
      type: Boolean,
      default: false,
    },
    taskAssigned: [taskSchema],
    addedLead: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LeadOrder",
      }
    ],
  },
  {
    timestamps: true,
  }
);

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });

// 🔑 Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next(); // Only hash if password is modified/created

  try {
    const salt = await bcrypt.genSalt(10); // 10 rounds of salt (good balance between security & performance)
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// 🔑 Method to compare password for login
userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);

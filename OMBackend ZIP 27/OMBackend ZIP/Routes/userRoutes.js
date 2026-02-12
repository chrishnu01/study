const express = require('express');
const userController = require('../controllers/userController');
const userToken = require('../middleware/userToken');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

const router = express.Router();

// Multiple file fields (extend as needed)
const uploadFields = upload.fields([
    { name: "quotationFiles", maxCount: 10 },
    { name: "orderDocuments", maxCount: 10 },
    { name: "orderDataDocuments", maxCount: 10 },
    { name: "dispatchDocuments", maxCount: 10 },
    { name: "dispatchDataDocuments", maxCount: 10 },
    { name: "returnDocuments", maxCount: 10 },
    { name: "returnDataDocuments", maxCount: 10 },
    { name: "billingFiles", maxCount: 10 },
    { name: "billingDataFiles", maxCount: 10 },
    { name: "paymentDataFiles", maxCount: 10 },
    { name: "securityDocument", maxCount: 10 },
    { name: "aggrementDocument", maxCount: 10 },
    { name: "leadFollowUpsDocuments", maxCount: 10 },
    { name: "aadharFile", maxCount: 1 },
    { name: "panFile", maxCount: 1 },
    { name: "authLetterFile", maxCount: 1 },
    { name: "contactPersonAadharFile", maxCount: 1 },
    { name: "contactPersonPanFile", maxCount: 1 },
    { name: "firmCompanyGstFile", maxCount: 1 },
]);

router.post('/userLogin', userController.userLogin);
router.post('/registerUser', userController.registerUser);
router.get('/getUser', userToken, userController.getUser);
router.get('/getAllUsers', userToken, userController.getAllUsers);
router.put('/updateUser', userToken, userController.updateUser);
router.put('/updatePassword', userToken, userController.updatePassword);
router.delete('/deleteUser', userToken, userController.deleteUser);
router.delete('/deleteSelectedUser/:id', userToken, userController.deleteSelectedUser);
router.put('/changePermission/:targetUserId', userToken, userController.changePermission);

router.post('/createLead', userToken, userController.createLead);
router.get('/getAllLeads', userToken, userController.getAllLeads);
router.get('/getCustomerLeads', userToken, userController.getCustomerLeads);
router.get('/getUserLead', userToken, userController.getUserLead);
router.get('/getLeadAllotedTo', userToken, userController.getLeadAllotedTo);
router.get('/leadById/:id', userToken, userController.getLeadById);
router.get('/getQuotationById', userToken, userController.getQuotationById);
router.patch('/updateLead/:id', userToken, uploadFields, userController.updateLeadOrder);
router.put('/updateLeadQuotation', userToken, userController.updateLeadQuotation);
router.put('/updateLeadQuotationSale', userToken, userController.updateLeadQuotationSale);
router.post('/createNewQuotation', userToken, userController.createNewQuotation);
router.put('/updateQuotationFollowUp', userToken, userController.updateLeadQuotationFollowUp);
router.put('/updateStatus/:id', userToken, userController.updateStatus);
router.put('/updateFollowUpStatus/:id', userToken, userController.updateFollowUpStatus);
router.delete('/deleteLead/:id', userToken, userController.deleteLead);
router.put('/updateLeadToDiscard/:id', userToken, userController.updateLeadToDiscard);
router.delete('/deleteFile/:id', userToken, userController.deleteFile);
router.delete('/deleteLeadFollowUp/:leadId/:followUpId', userToken, userController.deleteLeadFollowUps);
router.delete('/deleteQuotationFollowUps/:leadId/:followUpId', userToken, userController.deleteQuotationFollowUps);
router.delete('/deletePaymentFollowUp/:leadId/:followUpId', userToken, userController.deletePaymentFollowUps);
router.delete('/deleteBillingFollowUps/:leadId/:followUpId', userToken, userController.deleteBillingFollowUps);
router.delete('/deleteLegalFollowUps/:leadId/:followUpId', userToken, userController.deleteLegalFollowUps);
router.put("/editSubData/:leadId/:id", userToken, uploadFields, userController.editSubData);
router.delete("/deleteSubData/:leadId/:id", userToken, userController.deleteSubData);
router.get('/showFollowUps', userToken, userController.showFollowUps);
router.get('/getDashboardFollowUps', userToken, userController.getDashboardFollowUps);
router.get('/getDashboardData', userToken, userController.getDashboardData);
router.get('/showData', userToken, userController.showData);
router.post('/addLeadAllotedTo', userToken, userController.addLeadAllotedTo);
router.delete('/removeLeadAllotedTo', userToken, userController.removeLeadAllotedTo);
router.delete('/deleteLeadMessage', userToken, userController.deleteLeadMessage);
router.post('/addLeadMessageResponse', userToken, userController.addLeadMessageResponse);
router.post('/updateLeadMessage', userToken, userController.updateLeadMessage);
router.get('/getLeadNamesAndId', userToken, userController.getLeadNamesAndId);
router.get('/getAllVisits', userToken, userController.getAllVisits);
router.post('/createLeadFromVisit/:visitId', userToken, userController.createLeadFromVisit);
router.get('/getReport', userToken, userController.getReport);
router.post('/getUserReportStats', userToken, userController.getUserReportStats);

router.post('/createQuotation', userToken, userController.createQuotation);
router.get('/getQuotation', userToken, userController.getQuotation);
router.put('/updateQuotation/:id', userToken, userController.updateQuotation);
router.delete('/deleteQuotation/:id', userToken, userController.deleteQuotation);

router.post('/addTermCondition', userToken, userController.addTermCondition);
router.get('/getTermConditions', userToken, userController.getAllTermConditions);
router.put('/updateTermCondition/:id', userToken, userController.updateTermCondition);
router.delete('/deleteTermCondition/:id', userToken, userController.deleteTermCondition);

router.post("/createUnits", userToken, userController.createUnits);
router.get("/getUnits", userToken, userController.getUnits);
router.patch("/updateUnit/:id", userToken, userController.updateUnit);
router.delete("/deleteUnit/:id", userToken, userController.deleteUnit);

router.post("/createSource", userToken, userController.createSources);
router.get("/getAllSource", userToken, userController.getSources);
router.put("/updateSource/:id", userToken, userController.updateSource);
router.delete("/deleteSource/:id", userToken, userController.deleteSource);

router.post("/createTaskAssigned/:userID", userToken, userController.createTaskAssigned);
router.get("/getTaskAssignedByID", userToken, userController.getTaskAssignedByID);
router.put("/updateAssignedTask/:userID/:taskId", userToken, userController.updateAssignedTask);
router.delete("/deleteAssignedTask/:userID/:taskId", userToken, userController.deleteAssignedTask);

module.exports = router;
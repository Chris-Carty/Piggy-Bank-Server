import dotenv from 'dotenv'
import axios from 'axios'
import conn from '../config/dbConfig.js'
import { v4 as uuidv4 } from 'uuid';
import * as tlSigning from 'truelayer-signing'

dotenv.config({ path: '../.env' }); // Load environment variables into process.env

// TrueLayer console variables
const clientId = process.env.CLIENT_ID
const clientSecret = process.env.CLIENT_SECRET
const kid = process.env.CERTIFICATE_ID
const privateKeyPem = process.env.PRIVATE_KEY
const rvnuMerchantAccountId = process.env.RVNU_MERCHANT_ACCOUNT_ID

// Retrieve access token to enable payment initiation
export const getAccessToken = async (req, res) => {

  const options = {
    method: 'POST',
    url: 'https://auth.truelayer-sandbox.com/connect/token',
    data: {
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'payments',
      grant_type: 'client_credentials'
    }
  };
  
  axios.request(options).then(response =>
    res.json(response.data.access_token)
  ).catch(function (error) {
    res.send({ message: error});
  });

}

export const initiatePayment = async (req, res) => {

  // Payment Information 
  const amount = req.params.amount * 100
  const amountRounded = Math.round((amount + Number.EPSILON) * 100) / 100
  const currency = req.params.currency
  const reference = req.params.reference
  const MerchantName = req.params.merchantName

  // Payer Information
  const payerPhoneNumber = req.params.payerMobile
  const payerName = req.params.payerName
  const payerId = req.params.payerAccountID

  // TO DO - request from DB and unencrypt
  //const payerSortCode = req.params.sortCode
  //const payerAccountNumber = req.params.AccountNumber

  // Set random idempotencyKey
  const idempotencyKey = uuidv4();

  // Access Token
  const accessToken = req.params.accessToken
    
  // SOURCE ACCOUNT PRESELECTED ROUTE

  const body = '{"payment_method":{"type":"bank_transfer","provider_selection":{"type":"preselected","scheme_selection":{"type":"instant_only","allow_remitter_fee":false}, "remitter": {"account_identifier": {"type": "sort_code_account_number","sort_code": "101010", "account_number": "12345681"},"account_holder_name": "Chris Carty"}, "provider_id": "mock-payments-gb-redirect","scheme_id": "faster_payments_service"},"beneficiary":{"type":"merchant_account","merchant_account_id":"' + rvnuMerchantAccountId + '", "account_holder_name":"' + MerchantName + '", "reference":"' + reference + '"}},"user":{"id":"' + payerId + '","name":"' + payerName + '","phone":"' + payerPhoneNumber + '"},"amount_in_minor":' + amountRounded + ',"currency":"' + currency + '"}'

  /*

  // BANK SLECTION ROUTE

  const body = '{"payment_method":{"type":"bank_transfer","provider_selection":{"type":"user_selected","scheme_selection":{"type":"instant_only","allow_remitter_fee":false}},"beneficiary":{"type":"merchant_account","merchant_account_id":"73bbdbf2-4848-4a03-8166-adacdf20490b", "account_holder_name":"' + MerchantName + '", "reference":"' + reference + '"}},"user":{"id":"' + payerId + '","name":"' + payerName + '","phone":"' + payerPhoneNumber + '"},"amount_in_minor":' + amountRounded + ',"currency":"' + currency + '"}'

  */
  
  
  const tlSignature = tlSigning.sign({
      kid,
      privateKeyPem,
      method: "POST", // as we're sending a POST request
      path: "/payments", // the path of our request
      // All signed headers *must* be included unmodified in the request.
      headers: { 
      "Idempotency-Key": idempotencyKey,
      "Content-Type": "application/json", 
      },
      body,
  });
    
  const request = {
      method: "POST",
      url: "https://api.truelayer-sandbox.com/payments",
      // Request body & any signed headers *must* exactly match what was used to generate the signature.
      data: body,
      headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Idempotency-Key": idempotencyKey,
      "Content-Type": "application/json",
      "Tl-Signature": tlSignature,
      }
  };
  
  axios.request(request).then(response =>
     res.json('https://payment.truelayer-sandbox.com/payments#payment_id=' + response.data.id + '&resource_token=' + response.data.resource_token + '&return_uri=http://localhost:3000&c_primary=262626&c_secondary=000000&c_tertiary=000000') 
  ).catch(function (error) {
    res.send({ message: error});
    console.log(error.response.data)
  });
    
}


// Store Transaction Information in Database
export const storeTransaction = async (req, res) => {


    const paymentID = req.params.transactionID
    const merchantID = req.params.merchantID
    const accountID = req.params.payerAccountID
    const recommenderID = req.params.recommenderID
    const currency = req.params.currency
    const amount = req.params.amount
    const reference = req.params.reference
    const assetsUpdated = 0
    const rvnuServiceFee = (amount * 0.007)
    const rvnuFeeRounded = Math.round((rvnuServiceFee + Number.EPSILON) * 100) / 100

    const query = `SELECT CommissionPercentage FROM Merchant WHERE MerchantID='${merchantID}'`

    try {

      conn.query(query, (err, data) => {
        if(err) return res.status(409).send({ message: err.message })
        //res.status(200).json({data});
        //console.log(res.status(200).json({data}))

        Object.keys(data).forEach(function(key) {
          var row = data[key];
          const merchantCommissionPercentage = row.CommissionPercentage

          // Calc commision for user who's code was used
          const recommenderCommissionEarned  = amount * (merchantCommissionPercentage / 100)
          const recommenderCommissionRounded = Math.round((recommenderCommissionEarned + Number.EPSILON) * 100) / 100

      

          const query = `INSERT INTO RvnuTransaction (PaymentID, MerchantID, AccountID, DateTime, Currency, TotalAmount, RvnuFee, RecommenderID, RecommenderCommission, RecommenderAssetsUpdated, Reference) VALUES ('${paymentID}', '${merchantID}', '${accountID}', CURRENT_TIMESTAMP, '${currency}', '${amount}','${rvnuFeeRounded}', '${recommenderID}', '${recommenderCommissionRounded}', '${assetsUpdated}','${reference}')`


          try {
            conn.query(query, (err, data) => {
              if(err) return res.status(409).send({ message: err.message })
              res.status(200).json({data});
      
          });
          } catch (err) {
              res.status(409).send({ message: err.message })
              console.log(error.response.data)
          }

      });
    });
    } catch (err) {
        res.status(409).send({ message: err.message })
    }

}


// Retrieve access token to enable payment initiation
export const getPaymentStatus = async (req, res) => {

  const accessToken = req.params.accessToken
  const paymentId = req.params.paymentId

  const request = {
    method: "GET",
    url: `https://api.truelayer-sandbox.com/payments/${paymentId}`,
    headers: {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    }
};
  
  axios.request(request).then(response =>
    res.json(response.data)
  ).catch(function (error) {
    res.send({ message: error});
  });

}

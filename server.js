const express = require('express');
const axios = require('axios');
const fs = require('fs').promises; // Use promises for async file reading
const winston = require('winston');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({
  origin: 'http://localhost:3000', // Replace with your frontend port (e.g., 5500 if using VS Code Live Server)
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.static(path.join(__dirname, 'public'))); // Adjust 'frontend' to your folder name
// Logger setup
// Improved logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      // Truncate very long messages to prevent console flooding
      const truncatedMessage = typeof message === 'string' && message.length > 500 
        ? message.substring(0, 500) + '... [truncated]' 
        : message;
      return `${timestamp} [${level}]: ${truncatedMessage}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    // Add file logging for errors
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Add file logging for all logs
    new winston.transports.File({ 
      filename: 'combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ]
});

/**
 * Cache mechanism to reduce duplicate API calls
 * LRU (Least Recently Used) cache implementation
 */
class DataCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  getKey(type, id, year) {
    return `${type}:${id}:${year}`;
  }

  get(type, id, year) {
    const key = this.getKey(type, id, year);
    const item = this.cache.get(key);
    
    if (item) {
      // Move to end of Map (most recently used)
      this.cache.delete(key);
      this.cache.set(key, item);
      return item;
    }
    
    return null;
  }

  set(type, id, year, data) {
    const key = this.getKey(type, id, year);
    
    // If cache is full, remove least recently used item (first item in Map)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, data);
  }

  clear() {
    this.cache.clear();
  }
}

// Initialize the cache
const dataCache = new DataCache(200);

/**
 * Determine the data source type for a given year
 * @param {number} year - The year to check
 * @returns {string} - 'confirmed', 'potential', 'simulated', or 'invalid'
 */
function getYearDataSourceType(year) {
  if (YEAR_CONFIG.confirmedDataYears.includes(year)) {
    return 'confirmed';
  } else if (YEAR_CONFIG.potentialDataYears.includes(year)) {
    return 'potential';
  } else if (YEAR_CONFIG.simulationYears.includes(year)) {
    return 'simulated';
  } else {
    return 'invalid';
  }
}

const YEAR_CONFIG = {
  // Years with confirmed real data availability
  confirmedDataYears: [2019, 2020, 2021, 2022, 2023],
  // Years with partial or potentially available data
  potentialDataYears: [2024],
  // Years that definitely need simulation
  simulationYears: [2025, 2026],
  // Default growth rates for simulation (%) based on industry averages
  defaultGrowthRates: {
    implantations: 5.8, // 5.8% annual growth for medical devices
    payment: 7.2,       // 7.2% annual growth for healthcare spending
    spending: 8.5,      // 8.5% annual growth for drug spending
    claims: 4.3         // 4.3% annual growth for prescription claims
  }
};


// Add a custom log method for objects that prevents huge outputs
logger.logObject = (level, message, obj) => {
  // For debugging complex objects without flooding the console
  const safeObj = obj ? { 
    type: typeof obj,
    isArray: Array.isArray(obj),
    keys: Object.keys(obj).slice(0, 20), // Only show first 20 keys
    preview: JSON.stringify(obj).substring(0, 200) + '...' // Preview first 200 chars
  } : null;
  
  logger.log(level, `${message} - ${JSON.stringify(safeObj)}`);
};

// Add middleware to log all requests
app.use((req, res, next) => {
  // Log an abbreviated version of the request to avoid flooding logs
  logger.info(`${req.method} ${req.url} - Query params: ${Object.keys(req.query).join(', ')}`);
  next();
});

// Add a global error handler with better formatting
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(error.stack);
  // Exit after some time to allow logger to complete
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// CMS Dataset UUIDs - updated with the latest UUIDs
const CMS_PART_B_UUID = '6fea9d79-0129-4e4c-b1b8-23cd86a4f435'; // Medicare Physician & Other Practitioners
const CMS_PART_D_UUID = '9552739e-3d05-4c1b-8eff-ecabf391e2e5'; // Medicare Part D Prescribers

// Competitor Configuration
const competitors = [
  { 
    name: "LivaNova", 
    type: "device", 
    treatment: "Vagus Nerve Stimulation", 
    shortName: "VNS", 
    cptCodes: ["64568", "61885"], 
    keywords: ["Vagus Nerve Stimulation", "VNS"], 
    cik: "0001639691" 
  },
  { 
    name: "Medtronic", 
    type: "device", 
    treatment: "Deep Brain Stimulation", 
    shortName: "DBS", 
    cptCodes: ["61863", "61864", "61885", "61886"], 
    keywords: ["Deep Brain Stimulation", "DBS"], 
    cik: "0001613103" 
  },
  { 
    name: "NeuroPace", 
    type: "device", 
    treatment: "Responsive Neurostimulation", 
    shortName: "RNS", 
    cptCodes: ["61850", "61860", "61863", "61885", "61889"], 
    keywords: ["Responsive Neurostimulation", "RNS"],
    cik: "0001750346" // Added correct CIK for NeuroPace
  },
  { 
    name: "XCOPRI", 
    type: "drug", 
    treatment: "Cenobamate", 
    company: "SK Biopharmaceuticals", 
    keywords: ["Cenobamate", "XCOPRI"],
    cik: "0001815957" // Added CIK for SK Biopharmaceuticals (parent company)
  },
  { 
    name: "Precisis AG", 
    type: "early-stage", 
    treatment: "EASEE", 
    keywords: ["EASEE epilepsy"],
    cik: null // Private company, no CIK available
  },
  { 
    name: "Epi-Minder", 
    type: "early-stage", 
    treatment: "Seizure Monitoring", 
    keywords: ["Epi-Minder epilepsy"],
    cik: null // Private company, no CIK available
  },
  { 
    name: "Flow Medical", 
    type: "early-stage", 
    treatment: "Depression Device", 
    keywords: ["Flow Medical epilepsy"],
    cik: null // Private company, no CIK available
  }
];

// Utility function for retrying API requests
async function retryRequest(requestFn, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      logger.warn(`Request failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
      
      if (attempt < maxRetries) {
        // Wait before retrying (with exponential backoff)
        const waitTime = delay * Math.pow(2, attempt - 1);
        logger.info(`Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError;
}

// Function to safely extract values from nested objects without errors
function safeExtract(obj, path, defaultValue = 'Unknown') {
  try {
    const keys = path.split('.');
    let result = obj;
    
    for (const key of keys) {
      if (result === undefined || result === null) return defaultValue;
      
      // Handle array notation (e.g., "products[0]")
      if (key.includes('[') && key.includes(']')) {
        const arrayName = key.split('[')[0];
        const index = parseInt(key.split('[')[1].split(']')[0]);
        
        if (Array.isArray(result[arrayName]) && result[arrayName].length > index) {
          result = result[arrayName][index];
        } else {
          return defaultValue;
        }
      } else {
        result = result[key];
      }
    }
    
    // Handle arrays that might be empty
    if (Array.isArray(result)) {
      return result.length > 0 ? result[0] : defaultValue;
    }
    
    return result !== undefined && result !== null ? result : defaultValue;
  } catch (error) {
    logger.debug(`Error extracting path ${path}: ${error.message}`);
    return defaultValue;
  }
}

// Enhanced FDA Data Fetching with support for both devices and drugs
// Comprehensive FDA Data Fetching with alternative endpoints for drugs
// async function fetchFdaData(searchTerm, type = "device") {
//   return retryRequest(async () => {
//     let results = { 
//       endpoints: {}, 
//       combinedResults: []
//     };
    
//     // Define endpoints based on competitor type
//     const endpoints = {};
    
//     if (type === "drug") {
//       endpoints.drugsFda = "https://api.fda.gov/drug/drugsfda.json";
//       endpoints.label = "https://api.fda.gov/drug/label.json";
//       endpoints.ndc = "https://api.fda.gov/drug/ndc.json";
//       endpoints.enforcement = "https://api.fda.gov/drug/enforcement.json";
//       endpoints.event = "https://api.fda.gov/drug/event.json";
      
//       // Try with both brand name and generic name searches
//       const searchVariations = [
//         searchTerm, 
//         `XCOPRI`, // Special case for Cenobamate
//         `SK Biopharmaceuticals` // Manufacturer
//       ];
      
//       for (const [endpointName, baseUrl] of Object.entries(endpoints)) {
//         let endpointSuccess = false;
        
//         // Try each search variation
//         for (const variation of searchVariations) {
//           if (endpointSuccess) continue; // Skip if we already have data
          
//           try {
//             // Build search query based on endpoint
//             let searchQuery;
            
//             switch (endpointName) {
//               case "drugsFda":
//                 searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+sponsor_name:"${variation}"`;
//                 break;
//               case "label":
//                 searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+openfda.manufacturer_name:"${variation}"`;
//                 break;
//               case "ndc":
//                 searchQuery = `search=brand_name:"${variation}"+OR+generic_name:"${variation}"+OR+labeler_name:"${variation}"`;
//                 break;
//               case "enforcement":
//                 searchQuery = `search=product_description:"${variation}"`;
//                 break;
//               case "event":
//                 searchQuery = `search=patient.drug.medicinalproduct:"${variation}"+OR+patient.drug.openfda.brand_name:"${variation}"+OR+patient.drug.openfda.generic_name:"${variation}"`;
//                 break;
//               default:
//                 searchQuery = `search=${variation}`;
//             }
            
//             // Make the API request
//             const url = `${baseUrl}?${searchQuery}&limit=5`;
//             logger.info(`Trying FDA ${endpointName} with search term: ${variation}`);
            
//             const response = await axios.get(url, { timeout: 10000 });
            
//             if (response.data && response.data.results && Array.isArray(response.data.results) && response.data.results.length > 0) {
//               logger.info(`Success! Found FDA data from ${endpointName} for ${variation}`);
//               results.endpoints[endpointName] = {
//                 status: "success",
//                 count: response.data.results.length,
//                 data: response.data.results,
//                 searchTerm: variation
//               };
              
//               // Process the results
//               const processedResults = processEndpointResults(endpointName, response.data.results, searchTerm, type);
//               results.combinedResults = [...results.combinedResults, ...processedResults];
              
//               endpointSuccess = true;
//               break; // Exit the variations loop for this endpoint
//             }
//           } catch (error) {
//             logger.warn(`Failed FDA ${endpointName} request for ${variation}: ${error.message}`);
//           }
//         }
        
//         // If no success with any variation, record the failure
//         if (!endpointSuccess) {
//           results.endpoints[endpointName] = {
//             status: "error",
//             error: "No data found across all search variations",
//             statusCode: "404",
//             data: []
//           };
//         }
//       }
//     } else {
//       // For devices, maintain original approach with device-specific endpoints
//       endpoints.device510k = "https://api.fda.gov/device/510k.json";
//       endpoints.classification = "https://api.fda.gov/device/classification.json";
//       endpoints.enforcement = "https://api.fda.gov/device/enforcement.json";
//       endpoints.event = "https://api.fda.gov/device/event.json";
//       endpoints.pma = "https://api.fda.gov/device/pma.json";
//       endpoints.recall = "https://api.fda.gov/device/recall.json";
//       endpoints.registrationlisting = "https://api.fda.gov/device/registrationlisting.json";
      
//       // Process each device endpoint
//       for (const [endpointName, baseUrl] of Object.entries(endpoints)) {
//         try {
//           // Build the search query based on endpoint
//           let searchQuery;
          
//           switch (endpointName) {
//             case "device510k":
//               searchQuery = `search=device_name:"${searchTerm}"+OR+device_name:${searchTerm}`;
//               break;
//             case "classification":
//               searchQuery = `search=device_name:"${searchTerm}"+OR+device_name:${searchTerm}`;
//               break;
//             case "enforcement":
//               searchQuery = `search=product_description:"${searchTerm}"`;
//               break;
//             case "event":
//               searchQuery = `search=device.brand_name:"${searchTerm}"`;
//               break;
//             case "pma":
//               searchQuery = `search=device_name:"${searchTerm}"+OR+device_name:${searchTerm}`;
//               break;
//             case "recall":
//               searchQuery = `search=product_description:"${searchTerm}"`;
//               break;
//             case "registrationlisting":
//               searchQuery = `search=device_name:"${searchTerm}"`;
//               break;
//             default:
//               searchQuery = `search=${searchTerm}`;
//           }
  
//           // Make the API request
//           const url = `${baseUrl}?${searchQuery}&limit=5`;
//           logger.info(`Fetching FDA data from ${endpointName}: ${url}`);
          
//           const response = await axios.get(url, { timeout: 10000 });
          
//           // Process results based on endpoint
//           if (response.data && response.data.results && Array.isArray(response.data.results)) {
//             results.endpoints[endpointName] = {
//               status: "success",
//               count: response.data.results.length,
//               data: response.data.results
//             };
            
//             // Process the results for each endpoint
//             const processedResults = processEndpointResults(endpointName, response.data.results, searchTerm, type);
//             results.combinedResults = [...results.combinedResults, ...processedResults];
//           } else {
//             results.endpoints[endpointName] = {
//               status: "empty",
//               count: 0,
//               data: []
//             };
//           }
//         } catch (error) {
//           logger.error(`FDA ${endpointName} API error for ${searchTerm}: ${error.message}`);
          
//           results.endpoints[endpointName] = {
//             status: "error",
//             error: error.message,
//             statusCode: error.response?.status || 'unknown',
//             data: []
//           };
//         }
//       }
//     }
    
//     // If no results found across all endpoints, add placeholder data
//     if (results.combinedResults.length === 0) {
//       results.combinedResults = [{
//         source: "placeholder",
//         name: searchTerm,
//         description: `No FDA data found for ${searchTerm} across all endpoints`,
//         date: "Unknown",
//         status: "Unknown"
//       }];
//     }
    
//     return results;
//   }, 3, 2000); // 3 retries with 2 second delay
// }
async function fetchFdaData(searchTerm, type = "device") {
  return retryRequest(async () => {
    let results = { 
      endpoints: {}, 
      combinedResults: []
    };
    
    // Define endpoints based on competitor type
    const endpoints = {};
    
    if (type === "drug") {
      endpoints.drugsFda = "https://api.fda.gov/drug/drugsfda.json";
      endpoints.label = "https://api.fda.gov/drug/label.json";
      endpoints.ndc = "https://api.fda.gov/drug/ndc.json";
      endpoints.enforcement = "https://api.fda.gov/drug/enforcement.json";
      endpoints.event = "https://api.fda.gov/drug/event.json";
      
      // Try with both brand name and generic name searches
      const searchVariations = [
        searchTerm, 
        `XCOPRI`, // Special case for Cenobamate
        `SK Biopharmaceuticals` // Manufacturer
      ];
      
      for (const [endpointName, baseUrl] of Object.entries(endpoints)) {
        let endpointSuccess = false;
        
        // Try each search variation
        for (const variation of searchVariations) {
          if (endpointSuccess) continue; // Skip if we already have data
          
          try {
            // Build search query based on endpoint
            let searchQuery;
            
            switch (endpointName) {
              case "drugsFda":
                searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+sponsor_name:"${variation}"`;
                break;
              case "label":
                searchQuery = `search=openfda.brand_name:"${variation}"+OR+openfda.generic_name:"${variation}"+OR+openfda.manufacturer_name:"${variation}"`;
                break;
              case "ndc":
                searchQuery = `search=brand_name:"${variation}"+OR+generic_name:"${variation}"+OR+labeler_name:"${variation}"`;
                break;
              case "enforcement":
                searchQuery = `search=product_description:"${variation}"`;
                break;
              case "event":
                searchQuery = `search=patient.drug.medicinalproduct:"${variation}"+OR+patient.drug.openfda.brand_name:"${variation}"+OR+patient.drug.openfda.generic_name:"${variation}"`;
                break;
              default:
                searchQuery = `search=${variation}`;
            }
            
            // Make the API request with increased limit
            const url = `${baseUrl}?${searchQuery}&limit=100`; // Increased from 5 to 100
            logger.info(`Trying FDA ${endpointName} with search term: ${variation}`);
            
            const response = await axios.get(url, { timeout: 15000 });
            
            if (response.data && response.data.results && Array.isArray(response.data.results) && response.data.results.length > 0) {
              logger.info(`Success! Found FDA data from ${endpointName} for ${variation}`);
              results.endpoints[endpointName] = {
                status: "success",
                count: response.data.results.length,
                data: response.data.results,
                searchTerm: variation
              };
              
              // Process the results
              const processedResults = processEndpointResults(endpointName, response.data.results, searchTerm, type);
              results.combinedResults = [...results.combinedResults, ...processedResults];
              
              endpointSuccess = true;
              break; // Exit the variations loop for this endpoint
            }
          } catch (error) {
            logger.warn(`Failed FDA ${endpointName} request for ${variation}: ${error.message}`);
          }
        }
        
        // If no success with any variation, record the failure
        if (!endpointSuccess) {
          results.endpoints[endpointName] = {
            status: "error",
            error: "No data found across all search variations",
            statusCode: "404",
            data: []
          };
        }
      }
    } else {
      // For devices, maintain original approach with device-specific endpoints
      endpoints.device510k = "https://api.fda.gov/device/510k.json";
      endpoints.classification = "https://api.fda.gov/device/classification.json";
      endpoints.enforcement = "https://api.fda.gov/device/enforcement.json";
      endpoints.event = "https://api.fda.gov/device/event.json";
      endpoints.pma = "https://api.fda.gov/device/pma.json";
      endpoints.recall = "https://api.fda.gov/device/recall.json";
      endpoints.registrationlisting = "https://api.fda.gov/device/registrationlisting.json";
      
      // Process each device endpoint with more results
      for (const [endpointName, baseUrl] of Object.entries(endpoints)) {
        try {
          // Build the search query based on endpoint
          let searchQuery;
          
          switch (endpointName) {
            case "device510k":
              searchQuery = `search=device_name:"${searchTerm}"+OR+device_name:${searchTerm}`;
              break;
            case "classification":
              searchQuery = `search=device_name:"${searchTerm}"+OR+device_name:${searchTerm}`;
              break;
            case "enforcement":
              searchQuery = `search=product_description:"${searchTerm}"`;
              break;
            case "event":
              searchQuery = `search=device.brand_name:"${searchTerm}"`;
              break;
            case "pma":
              searchQuery = `search=device_name:"${searchTerm}"+OR+device_name:${searchTerm}`;
              break;
            case "recall":
              searchQuery = `search=product_description:"${searchTerm}"`;
              break;
            case "registrationlisting":
              searchQuery = `search=device_name:"${searchTerm}"`;
              break;
            default:
              searchQuery = `search=${searchTerm}`;
          }
  
          // Make the API request with increased limit
          const url = `${baseUrl}?${searchQuery}&limit=100`; // Increased from 5 to 100
          logger.info(`Fetching FDA data from ${endpointName}: ${url}`);
          
          const response = await axios.get(url, { timeout: 15000 });
          
          // Process results based on endpoint
          if (response.data && response.data.results && Array.isArray(response.data.results)) {
            results.endpoints[endpointName] = {
              status: "success",
              count: response.data.results.length,
              data: response.data.results
            };
            
            // Process the results for each endpoint
            const processedResults = processEndpointResults(endpointName, response.data.results, searchTerm, type);
            results.combinedResults = [...results.combinedResults, ...processedResults];
          } else {
            results.endpoints[endpointName] = {
              status: "empty",
              count: 0,
              data: []
            };
          }
        } catch (error) {
          logger.error(`FDA ${endpointName} API error for ${searchTerm}: ${error.message}`);
          
          results.endpoints[endpointName] = {
            status: "error",
            error: error.message,
            statusCode: error.response?.status || 'unknown',
            data: []
          };
        }
      }
    }
    
    // If no results found across all endpoints, add placeholder data
    if (results.combinedResults.length === 0) {
      results.combinedResults = [{
        source: "placeholder",
        name: searchTerm,
        description: `No FDA data found for ${searchTerm} across all endpoints`,
        date: "Unknown",
        status: "Unknown"
      }];
    }
    
    return results;
  }, 3, 2000); // 3 retries with 2 second delay
}
// Enhanced CMS Part B Data with detailed field mapping
/**
 * Fetches CMS Part B data for a CPT code and year with enhanced year validation
 * @param {string} cptCode - The CPT/HCPCS code
 * @param {number} year - The service year
 * @returns {Promise<Object>} Object containing data and metadata about the source
 */
async function fetchCmsPartBData(cptCode, year) {
  // First, check the data source type for this year
  const dataSourceType = getYearDataSourceType(year);
  
  // Check cache first for any data source type
  const cachedData = dataCache.get('partB', cptCode, year);
  if (cachedData) {
    logger.debug(`Using cached data for CPT ${cptCode}, year ${year} (${dataSourceType})`);
    return cachedData;
  }
  
  // For simulated years, don't attempt API calls
  if (dataSourceType === 'simulated') {
    logger.info(`Using simulated data for CPT ${cptCode}, year ${year}`);
    // We'll handle simulation in a separate function
    return { 
      data: [], 
      metadata: { 
        dataSourceType,
        cptCode,
        year,
        message: `No real data available for ${year}. Simulation required.`
      }
    };
  }
  
  // For invalid years, return empty result
  if (dataSourceType === 'invalid') {
    logger.warn(`Invalid year requested for CPT ${cptCode}: ${year}`);
    return { 
      data: [], 
      metadata: { 
        dataSourceType,
        cptCode,
        year,
        message: `Invalid year ${year}. Only years ${YEAR_CONFIG.confirmedDataYears.join(', ')} and ${YEAR_CONFIG.potentialDataYears.join(', ')} have real data.`
      }
    };
  }
  
  // For potential years, log a warning
  if (dataSourceType === 'potential') {
    logger.info(`Attempting to fetch data for CPT ${cptCode}, year ${year} - data may be incomplete`);
  }
  
  // Now proceed with the actual API call for confirmed or potential years
  const baseUrl = `https://data.cms.gov/data-api/v1/dataset/${CMS_PART_B_UUID}/data`;
  const queryParams = `?filter[HCPCS_Cd]=${cptCode}&filter[Year]=${year}`;
  const url = baseUrl + queryParams;
  
  let allData = [];
  let pageOffset = 0;
  let hasMoreData = true;
  let maxRecords = 2000; // Reasonable limit
  let apiMetadata = {
    dataSourceType,
    cptCode,
    year,
    message: `Data retrieved from CMS API for year ${year}`,
    totalRequests: 0,
    successfulRequests: 0,
    totalRecords: 0,
    warnings: []
  };
  
  try {
    logger.info(`Fetching CMS Part B data for CPT: ${cptCode}, year: ${year} (${dataSourceType})`);
    
    // Implement pagination with detailed logging
    while (hasMoreData && allData.length < maxRecords) {
      const batchSize = allData.length === 0 ? 100 : 500;
      const paginatedUrl = `${url}&size=${batchSize}&offset=${pageOffset}`;
      
      logger.debug(`Request ${apiMetadata.totalRequests + 1} for CPT ${cptCode}, year ${year}: offset=${pageOffset}, size=${batchSize}`);
      apiMetadata.totalRequests++;
      
      try {
        const response = await axios.get(paginatedUrl, { 
          timeout: 20000, // 20 seconds timeout
          headers: { 'Accept': 'application/json' }
        });
        
        apiMetadata.successfulRequests++;
        
        if (Array.isArray(response.data) && response.data.length > 0) {
          logger.info(`Found ${response.data.length} records for CPT ${cptCode}, year ${year} (page ${Math.floor(pageOffset/batchSize) + 1})`);
          
          // Log detailed field information on first page
          if (pageOffset === 0) {
            const sampleKeys = Object.keys(response.data[0]);
            logger.debug(`Field names for ${year} data: ${sampleKeys.join(', ')}`);
            
            // Record field mapping for debugging
            apiMetadata.fieldMapping = {
              services: sampleKeys.includes('Tot_Srvcs') ? 'Tot_Srvcs' : 
                       (sampleKeys.includes('total_services') ? 'total_services' : null),
              payment: sampleKeys.includes('Avg_Mdcr_Pymt_Amt') ? 'Avg_Mdcr_Pymt_Amt' : 
                      (sampleKeys.includes('average_medicare_payment_amt') ? 'average_medicare_payment_amt' : null)
            };
            
            if (!apiMetadata.fieldMapping.services || !apiMetadata.fieldMapping.payment) {
              const warning = `Missing critical fields in API response for ${year}. Found: ${sampleKeys.join(', ')}`;
              logger.warn(warning);
              apiMetadata.warnings.push(warning);
            }
          }
          
          // Process and map the data with careful validation
          const batchData = response.data.map(d => {
            // Carefully handle different field names
            const services = parseFloat(d.Tot_Srvcs || d.total_services || 0);
            const avgPayment = parseFloat(d.Avg_Mdcr_Pymt_Amt || d.average_medicare_payment_amt || 0);
            
            // Skip records with obviously bad data
            if (services < 0 || avgPayment < 0) {
              apiMetadata.warnings.push(`Skipped record with negative values: services=${services}, avgPayment=${avgPayment}`);
              return null;
            }
            
            return {
              year: parseInt(year),
              implantations: services,
              avgPayment,
              totalPayment: services * avgPayment,
              providerCount: parseInt(d.Tot_Rndrng_Prvdrs || d.provider_count || 0),
              hcpcsCode: cptCode,
              hcpcsDescription: d.HCPCS_Desc || d.hcpcs_description || ""
            };
          }).filter(item => item !== null);
          
          allData = allData.concat(batchData);
          apiMetadata.totalRecords += batchData.length;
          
          // Check if we need more pages
          if (response.data.length < batchSize) {
            hasMoreData = false;
            logger.debug(`End of data reached for CPT ${cptCode}, year ${year}`);
          } else {
            pageOffset += batchSize;
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between requests
          }
        } else {
          hasMoreData = false;
          
          if (!response.data || response.data.length === 0) {
            const warning = `No data found for CPT ${cptCode}, year ${year}`;
            logger.warn(warning);
            apiMetadata.warnings.push(warning);
          }
        }
      } catch (requestError) {
        const errorMsg = `Error fetching CPT ${cptCode}, year ${year}: ${requestError.message}`;
        logger.error(errorMsg);
        apiMetadata.warnings.push(errorMsg);
        
        // Try with smaller batch on error
        if (batchSize > 100) {
          logger.info(`Retrying with smaller batch size for ${cptCode}, ${year}`);
          continue;
        }
        
        hasMoreData = false;
      }
    }
    
    // Try fallback if no data found
    if (allData.length === 0) {
      apiMetadata.warnings.push(`Primary API returned no data for ${cptCode}, ${year}. Trying fallback API.`);
      
      try {
        const fallbackUrl = `https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners/medicare-physician-other-practitioners-by-provider-and-service/api/1/datastore/query?conditions[hcpcs_code]=${cptCode}&conditions[year]=${year}&limit=500`;
        
        logger.info(`Using fallback API for CPT ${cptCode}, year ${year}`);
        apiMetadata.totalRequests++;
        
        const fallbackResponse = await axios.get(fallbackUrl, { timeout: 20000 });
        apiMetadata.successfulRequests++;
        
        if (fallbackResponse.data && fallbackResponse.data.results && fallbackResponse.data.results.length > 0) {
          logger.info(`Fallback API returned ${fallbackResponse.data.results.length} records for ${cptCode}, ${year}`);
          
          allData = fallbackResponse.data.results.map(d => {
            const services = parseFloat(d.total_services || d.tot_srvcs || 0);
            const avgPayment = parseFloat(d.average_medicare_payment_amt || d.avg_mdcr_pymt_amt || 0);
            
            return {
              year: parseInt(d.year || year),
              implantations: services,
              avgPayment,
              totalPayment: parseFloat(d.total_medicare_payment_amt || (services * avgPayment)),
              providerCount: parseInt(d.provider_count || d.tot_rndrng_prvdrs || 0),
              hcpcsCode: d.hcpcs_code || cptCode,
              hcpcsDescription: d.hcpcs_description || ""
            };
          });
          
          apiMetadata.totalRecords = allData.length;
          apiMetadata.message = `Data retrieved from fallback API for year ${year}`;
        }
      } catch (fallbackError) {
        const errorMsg = `Fallback API failed for ${cptCode}, ${year}: ${fallbackError.message}`;
        logger.error(errorMsg);
        apiMetadata.warnings.push(errorMsg);
      }
    }
    
    // Final validation
    if (allData.length > 0) {
      const totalImplantations = allData.reduce((sum, item) => sum + (item.implantations || 0), 0);
      
      if (totalImplantations === 0) {
        apiMetadata.warnings.push(`Data validation: Zero total implantations for ${cptCode}, ${year}`);
      }
      
      if (totalImplantations > 10000000) {
        apiMetadata.warnings.push(`Data validation: Suspiciously high implantation count (${totalImplantations}) for ${cptCode}, ${year}`);
      }
    }
    
    // Define the result with both data and metadata
    const result = { 
      data: allData,
      metadata: apiMetadata
    };
    
    // Cache the result
    dataCache.set('partB', cptCode, year, result);
    
    return result;
  } catch (error) {
    logger.error(`Critical error in fetchCmsPartBData for ${cptCode}, ${year}: ${error.message}`);
    return { 
      data: [], 
      metadata: {
        dataSourceType,
        cptCode,
        year,
        message: `Error: ${error.message}`,
        totalRequests: apiMetadata.totalRequests,
        successfulRequests: apiMetadata.successfulRequests,
        warnings: [...apiMetadata.warnings, error.message]
      }
    };
  }
}
// Helper to process endpoint-specific results into standardized format
function processEndpointResults(endpoint, results, searchTerm, type) {
  const processed = [];
  
  try {
    results.forEach(item => {
      const result = { source: endpoint };
      
      // Extract relevant fields based on endpoint and type
      if (type === "drug") {
        switch (endpoint) {
          case "drugsFda":
            result.name = safeExtract(item, 'products.0.brand_name') || safeExtract(item, 'products.0.generic_name') || "Unknown";
            result.description = `${safeExtract(item, 'sponsor_name')} - ${safeExtract(item, 'products.0.dosage_form')}`;
            result.date = safeExtract(item, 'application_details.approval_date') || safeExtract(item, 'products.0.marketing_status_date');
            result.status = safeExtract(item, 'application_type');
            break;
            
          case "label":
            result.name = safeExtract(item, 'openfda.brand_name.0') || safeExtract(item, 'openfda.generic_name.0');
            result.description = safeExtract(item, 'indications_and_usage.0')?.substring(0, 200) || "No description available";
            result.date = safeExtract(item, 'effective_time');
            result.status = safeExtract(item, 'openfda.product_type.0');
            break;
            
          case "ndc":
            result.name = safeExtract(item, 'brand_name') || safeExtract(item, 'generic_name');
            result.description = `${safeExtract(item, 'dosage_form')} - ${safeExtract(item, 'product_type')}`;
            result.date = safeExtract(item, 'marketing_start_date');
            result.status = safeExtract(item, 'marketing_category');
            break;
            
          case "enforcement":
            result.name = safeExtract(item, 'product_description');
            result.description = safeExtract(item, 'reason_for_recall') || "No reason provided";
            result.date = safeExtract(item, 'recall_initiation_date');
            result.status = safeExtract(item, 'status');
            break;
            
          case "event":
            const drug = item.patient?.drug?.find(d => 
              (d.openfda?.brand_name && d.openfda.brand_name.includes(searchTerm)) || 
              (d.openfda?.generic_name && d.openfda.generic_name.includes(searchTerm))
            );
            result.name = safeExtract(drug, 'openfda.brand_name.0') || safeExtract(drug, 'openfda.generic_name.0');
            result.description = safeExtract(item, 'patient.reaction.0.reactionmeddrapt') || "No reaction description";
            result.date = safeExtract(item, 'receiptdate');
            result.status = safeExtract(item, 'serious');
            break;
            
          default:
            result.name = "Data from " + endpoint;
            result.description = "Raw data available in detailed view";
            result.date = "Unknown";
            result.status = "Unknown";
        }
      } else {
        // Device endpoint processing
        switch (endpoint) {
          case "device510k":
            result.name = safeExtract(item, 'device_name');
            result.description = safeExtract(item, 'device_description') || "No description available";
            result.date = safeExtract(item, 'decision_date');
            result.status = safeExtract(item, 'decision_code');
            break;
            
          case "classification":
            result.name = safeExtract(item, 'device_name');
            result.description = safeExtract(item, 'device_class') || "No class info";
            result.date = safeExtract(item, 'medical_specialty_description');
            result.status = safeExtract(item, 'regulation_number');
            break;
            
          case "enforcement":
            result.name = safeExtract(item, 'product_description');
            result.description = safeExtract(item, 'reason_for_recall') || "No reason provided";
            result.date = safeExtract(item, 'recall_initiation_date');
            result.status = safeExtract(item, 'status');
            break;
            
          case "event":
            result.name = safeExtract(item, 'device.brand_name');
            result.description = safeExtract(item, 'mdr_text.0.text')?.substring(0, 200) || "No description available";
            result.date = safeExtract(item, 'date_received');
            result.status = safeExtract(item, 'event_type');
            break;
            
          case "pma":
            result.name = safeExtract(item, 'device_name');
            result.description = safeExtract(item, 'product_code') || "No description available";
            result.date = safeExtract(item, 'decision_date');
            result.status = safeExtract(item, 'decision');
            break;
            
          case "recall":
            result.name = safeExtract(item, 'product_description');
            result.description = safeExtract(item, 'reason_for_recall') || "No reason provided";
            result.date = safeExtract(item, 'recall_initiation_date');
            result.status = safeExtract(item, 'status');
            break;
            
          case "registrationlisting":
            result.name = safeExtract(item, 'device_name');
            result.description = `${safeExtract(item, 'device_class')} - ${safeExtract(item, 'medical_specialty_description')}`;
            result.date = safeExtract(item, 'completion_date_formatted');
            result.status = safeExtract(item, 'registration_status');
            break;
            
          default:
            result.name = "Data from " + endpoint;
            result.description = "Raw data available in detailed view";
            result.date = "Unknown";
            result.status = "Unknown";
        }
      }
      
      processed.push(result);
    });
  } catch (error) {
    logger.error(`Error processing FDA ${endpoint} results: ${error.message}`);
    // Add a placeholder entry if processing fails
    processed.push({
      source: endpoint,
      name: "Error processing data",
      description: error.message,
      date: "Unknown",
      status: "Error"
    });
  }
  
  return processed;
}

// Improved Patents API with fallback to mock data
// async function fetchPatents(searchTerms) {
//   try {
//     logger.info(`Enhanced patent search for terms: ${searchTerms.join(', ')}`);
    
//     const allPatents = [];
//     const patentIds = new Set(); // To track unique patents
    
//     // Try each search term individually for more comprehensive results
//     for (const term of searchTerms) {
//       try {
//         const patents = await fetchPatents(term);
        
//         if (patents && patents.length > 0) {
//           patents.forEach(patent => {
//             // Only add if not already in the results (using patent number as unique ID)
//             if (patent.patentNumber && !patentIds.has(patent.patentNumber)) {
//               patentIds.add(patent.patentNumber);
//               // Add the search term that found this patent
//               patent.foundVia = term;
//               allPatents.push(patent);
//             }
//           });
//         }
//       } catch (error) {
//         logger.warn(`Patent search error for term "${term}": ${error.message}`);
//         // Continue to next term
//       }
//     }
    
//     // Try additional search using smart compound terms if we have multiple terms
//     if (searchTerms.length > 1) {
//       try {
//         // Create compound searches like "term1 AND term2"
//         const compoundTerm = searchTerms.slice(0, 2).join(' ');
//         const patents = await fetchPatents(compoundTerm);
        
//         if (patents && patents.length > 0) {
//           patents.forEach(patent => {
//             if (patent.patentNumber && !patentIds.has(patent.patentNumber)) {
//               patentIds.add(patent.patentNumber);
//               patent.foundVia = `Compound: ${compoundTerm}`;
//               allPatents.push(patent);
//             }
//           });
//         }
//       } catch (error) {
//         logger.warn(`Compound patent search error: ${error.message}`);
//       }
//     }
    
//     // If no results found, try broader search terms
//     if (allPatents.length === 0 && searchTerms.length > 0) {
//       // Try partial matches by using just the first few characters of the first term
//       const broadTerm = searchTerms[0].substring(0, Math.min(5, searchTerms[0].length));
      
//       try {
//         logger.info(`Trying broader patent search with term: ${broadTerm}`);
//         const patents = await fetchPatents(broadTerm);
        
//         if (patents && patents.length > 0) {
//           patents.forEach(patent => {
//             if (patent.patentNumber && !patentIds.has(patent.patentNumber)) {
//               patentIds.add(patent.patentNumber);
//               patent.foundVia = `Broad: ${broadTerm}`;
//               allPatents.push(patent);
//             }
//           });
//         }
//       } catch (error) {
//         logger.warn(`Broader patent search error: ${error.message}`);
//       }
//     }
    
//     // Return all unique patents found
//     return allPatents;
//   } catch (error) {
//     logger.error(`Enhanced patent search error: ${error.message}`);
//     throw error;
//   }
// }
async function fetchPatents(keyword, maxResults = 1000) {
  return retryRequest(async () => {
    const url = `https://search.patentsview.org/api/v1/patent/`;
    let allPatents = [];
    const patentIdSet = new Set();
    
    try {
      logger.info(`Searching for up to ${maxResults} patents related to: ${keyword}`);
      
      // Set up pagination parameters
      const perPage = 100; // API max is 100 per page
      let hasMoreResults = true;
      let afterCursor = null;
      
      // Main query loop to fetch multiple pages
      while (hasMoreResults && allPatents.length < maxResults) {
        // Create payload for the current request
        const payload = {
          q: { 
            "_or": [
              { "_text_any": { "patent_title": keyword } },
              { "_text_all": { "patent_abstract": keyword } }
            ]
          },
          f: [
            "patent_id", 
            "patent_title", 
            "patent_date", 
            "patent_abstract", 
            "assignees.assignee_organization", 
            "patent_number",
            "patent_type",
            "inventors.inventor_first_name",
            "inventors.inventor_last_name"
          ],
          s: [{"patent_date": "desc"}], // Sort by date, most recent first
          o: { 
            "size": perPage,
            "matched_subentities_only": false
          }
        };
        
        // Add cursor for pagination after first page
        if (afterCursor) {
          payload.o.after = afterCursor;
        }
        
        logger.info(`Fetching patents batch (page cursor: ${afterCursor || 'initial'})`);
        
        const response = await axios.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Api-Key': 'sQ4l3fCxqzkaf0hP5YKpBxDDixBNy1RD'
          },
          timeout: 30000 // 30 second timeout
        });
        
        // Process response if we got valid data
        if (response.data && !response.data.error && response.data.patents && Array.isArray(response.data.patents)) {
          const pageResults = response.data.patents;
          
          if (pageResults.length > 0) {
            logger.info(`Found ${pageResults.length} patents in current batch`);
            
            // Filter out duplicates and add new patents
            const newPatents = pageResults.filter(patent => !patentIdSet.has(patent.patent_id));
            
            // Add new patent IDs to the set
            newPatents.forEach(patent => patentIdSet.add(patent.patent_id));
            
            // Add patents to our collection
            allPatents = [...allPatents, ...newPatents];
            
            // Set up for next page
            const lastPatent = pageResults[pageResults.length - 1];
            afterCursor = lastPatent.patent_id;
            
            // Check if we should continue pagination
            if (pageResults.length < perPage) {
              // Received fewer results than requested, likely the last page
              hasMoreResults = false;
            }
          } else {
            // No results on this page
            hasMoreResults = false;
          }
        } else {
          // Error in response
          const errorMessage = response.data?.error_message || "Unknown API error";
          logger.error(`Patents API error: ${errorMessage}`);
          hasMoreResults = false;
        }
        
        // Add a delay between requests to avoid rate limiting (45 requests/minute allowed)
        await new Promise(resolve => setTimeout(resolve, 1350)); // ~44 requests per minute
      }
      
      logger.info(`Total unique patents found in main query: ${allPatents.length}`);
      
      // If we don't have enough patents yet, try a fallback query
      if (allPatents.length < maxResults) {
        logger.info(`Trying fallback query to find more patents for: ${keyword}`);
        
        // Create a broader fallback query
        const fallbackPayload = {
          q: { 
            "_or": [
              { "_contains": { "patent_title": keyword } },
              { "_contains": { "patent_abstract": keyword } }
            ]
          },
          f: [
            "patent_id", 
            "patent_title", 
            "patent_date", 
            "patent_abstract", 
            "assignees.assignee_organization", 
            "patent_number",
            "patent_type",
            "inventors.inventor_first_name",
            "inventors.inventor_last_name"
          ],
          s: [{"patent_date": "desc"}],
          o: {
            "size": maxResults - allPatents.length,
            "matched_subentities_only": false
          }
        };
        
        const fallbackResponse = await axios.post(url, fallbackPayload, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Api-Key': process.env.PATENTSVIEW_API_KEY
          },
          timeout: 30000
        });
        
        if (fallbackResponse.data && !fallbackResponse.data.error && 
            fallbackResponse.data.patents && Array.isArray(fallbackResponse.data.patents)) {
          
          // Filter out duplicates
          const newPatents = fallbackResponse.data.patents.filter(
            patent => !patentIdSet.has(patent.patent_id)
          );
          
          logger.info(`Found ${newPatents.length} additional patents in fallback query`);
          
          // Add new patents to our collection
          allPatents = [...allPatents, ...newPatents];
        }
      }
      
      // Process and return the final results
      if (allPatents.length > 0) {
        logger.info(`Returning ${Math.min(allPatents.length, maxResults)} patents`);
        
        return allPatents.slice(0, maxResults).map(p => {
          // Process assignee organization
          let assignee = 'Unknown';
          if (p.assignees && p.assignees.length > 0 && p.assignees[0].assignee_organization) {
            assignee = p.assignees[0].assignee_organization;
          }
          
          // Process inventor name
          let inventor = 'Unknown';
          if (p.inventors && p.inventors.length > 0) {
            const inv = p.inventors[0];
            const firstName = inv.inventor_first_name || '';
            const lastName = inv.inventor_last_name || '';
            inventor = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
          }
          
          return {
            title: p.patent_title || 'Unknown',
            date: p.patent_date || 'Unknown',
            patentNumber: p.patent_id || 'Unknown',
            patentType: p.patent_type || 'Unknown',
            abstract: p.patent_abstract || 'No abstract available',
            assignee: assignee,
            inventor: inventor
          };
        });
      }
      
      // If we got no results at all, return mock data
      logger.warn(`No patent data found for ${keyword}, returning mock data`);
      return generateMockPatentData(keyword);
      
    } catch (error) {
      logger.error(`Patents API error for ${keyword}: ${error.message}`);
      return generateMockPatentData(keyword);
    }
  });
}
// Helper function to generate mock patent data
function generateMockPatentData(keyword) {
  const today = new Date();
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(today.getFullYear() - 2);
  
  const fourYearsAgo = new Date();
  fourYearsAgo.setFullYear(today.getFullYear() - 4);
  
  return [
    {
      title: `Methods and compositions related to ${keyword}`,
      date: twoYearsAgo.toISOString().split('T')[0],
      patentNumber: 'US10XXXXXX',
      abstract: `This is placeholder data for a patent related to ${keyword} as the Patents API request failed.`,
      assignee: 'Major Pharmaceutical Company Inc.'
    },
    {
      title: `Treatment of disorders using ${keyword} compounds`,
      date: fourYearsAgo.toISOString().split('T')[0],
      patentNumber: 'US98XXXXXX',
      abstract: `This is placeholder data for a patent related to ${keyword} as the Patents API request failed.`,
      assignee: 'Research University'
    }
  ];
}

// Enhanced CMS Part B Data fetching using the newer CMS API
// async function fetchCmsPartBData(cptCode, year) {
//   const url = `https://data.cms.gov/data-api/v1/dataset/${CMS_PART_B_UUID}/data?filter[HCPCS_CODE]=${cptCode}&filter[SVC_YR]=${year}&size=5000`;
  
//   try {
//     logger.info(`Fetching CMS Part B data for CPT: ${cptCode}, year: ${year}`);
//     const response = await axios.get(url);
    
//     if (Array.isArray(response.data) && response.data.length > 0) {
//       logger.info(`Found ${response.data.length} CMS Part B records for ${cptCode}, ${year}`);
//       return response.data.map(d => ({
//         year: parseInt(d.SVC_YR || year),
//         implantations: parseInt(d.TOT_SRVCS || 0),
//         avgPayment: parseFloat(d.AVG_MDCR_PMT_AMT || 0),
//         totalPayment: parseFloat(d.TOT_MDCR_PMT_AMT || 0),
//         providerCount: parseInt(d.TOT_PRVDRS || 0),
//         hcpcsCode: d.HCPCS_CODE,
//         hcpcsDescription: d.HCPCS_DESC || "Unknown"
//       }));
//     } else {
//       logger.warn(`No CMS Part B data found for ${cptCode}, ${year}`);
//       return [];
//     }
//   } catch (error) {
//     logger.error(`CMS Part B error for ${cptCode}, ${year}: ${error.message}`);
    
//     // Try fallback endpoint if available
//     try {
//       const fallbackUrl = `https://data.cms.gov/resource/97y4-7qau.json?hcpcs_code=${cptCode}&year=${year}&$limit=1000`;
//       logger.info(`Trying fallback CMS Part B endpoint for ${cptCode}, ${year}`);
      
//       const fallbackResponse = await axios.get(fallbackUrl);
      
//       if (Array.isArray(fallbackResponse.data) && fallbackResponse.data.length > 0) {
//         logger.info(`Found ${fallbackResponse.data.length} CMS Part B records from fallback endpoint`);
//         return fallbackResponse.data.map(d => ({
//           year: parseInt(d.year || year),
//           implantations: parseInt(d.total_services || 0),
//           avgPayment: parseFloat(d.average_medicare_allowed_amt || 0),
//           totalPayment: parseFloat(d.medicare_payment_amt || 0),
//           providerCount: parseInt(d.suppressed_providers || 0),
//           hcpcsCode: d.hcpcs_code,
//           hcpcsDescription: d.hcpcs_description || "Unknown"
//         }));
//       }
//     } catch (fallbackError) {
//       logger.error(`CMS Part B fallback error: ${fallbackError.message}`);
//     }
    
//     // Return empty array if all attempts fail
//     return [];
//   }
// }

// Enhanced CMS Part D Data fetching
/**
 * Fetches CMS Part D data for a drug name and year with enhanced year validation
 * @param {string} drugName - The drug name
 * @param {number} year - The service year
 * @returns {Promise<Object>} Object containing data and metadata about the source
 */
async function fetchCmsPartDData(drugName, year) {
  // First, check the data source type for this year
  const dataSourceType = getYearDataSourceType(year);
  
  // Check cache first for any data source type
  const cachedData = dataCache.get('partD', drugName, year);
  if (cachedData) {
    logger.debug(`Using cached data for drug ${drugName}, year ${year} (${dataSourceType})`);
    return cachedData;
  }
  
  // For simulated years, don't attempt API calls
  if (dataSourceType === 'simulated') {
    logger.info(`Using simulated data for drug ${drugName}, year ${year}`);
    return { 
      data: [], 
      metadata: { 
        dataSourceType,
        drugName,
        year,
        message: `No real data available for ${year}. Simulation required.`
      }
    };
  }
  
  // For invalid years, return empty result
  if (dataSourceType === 'invalid') {
    logger.warn(`Invalid year requested for drug ${drugName}: ${year}`);
    return { 
      data: [], 
      metadata: { 
        dataSourceType,
        drugName,
        year,
        message: `Invalid year ${year}. Only years ${YEAR_CONFIG.confirmedDataYears.join(', ')} and ${YEAR_CONFIG.potentialDataYears.join(', ')} have real data.`
      }
    };
  }
  
  // For potential years, log a warning
  if (dataSourceType === 'potential') {
    logger.info(`Attempting to fetch data for drug ${drugName}, year ${year} - data may be incomplete`);
  }
  
  // Now proceed with the actual API call for confirmed or potential years
  const baseUrl = `https://data.cms.gov/data-api/v1/dataset/${CMS_PART_D_UUID}/data`;
  const queryParams = `?filter[Brnd_Name]=${encodeURIComponent(drugName)}&filter[Year]=${year}`;
  const url = baseUrl + queryParams;
  
  let allData = [];
  let pageOffset = 0;
  let hasMoreData = true;
  let maxRecords = 2000; // Reasonable limit
  let apiMetadata = {
    dataSourceType,
    drugName,
    year,
    message: `Data retrieved from CMS API for year ${year}`,
    totalRequests: 0,
    successfulRequests: 0,
    totalRecords: 0,
    warnings: []
  };
  
  try {
    logger.info(`Fetching CMS Part D data for drug: ${drugName}, year: ${year} (${dataSourceType})`);
    
    // Implement pagination with detailed logging
    while (hasMoreData && allData.length < maxRecords) {
      const batchSize = allData.length === 0 ? 100 : 500;
      const paginatedUrl = `${url}&size=${batchSize}&offset=${pageOffset}`;
      
      logger.debug(`Request ${apiMetadata.totalRequests + 1} for drug ${drugName}, year ${year}: offset=${pageOffset}, size=${batchSize}`);
      apiMetadata.totalRequests++;
      
      try {
        const response = await axios.get(paginatedUrl, { 
          timeout: 20000, // 20 seconds timeout
          headers: { 'Accept': 'application/json' }
        });
        
        apiMetadata.successfulRequests++;
        
        if (Array.isArray(response.data) && response.data.length > 0) {
          logger.info(`Found ${response.data.length} records for drug ${drugName}, year ${year} (page ${Math.floor(pageOffset/batchSize) + 1})`);
          
          // Log detailed field information on first page
          if (pageOffset === 0) {
            const sampleKeys = Object.keys(response.data[0]);
            logger.debug(`Field names for ${year} data: ${sampleKeys.join(', ')}`);
            
            // Record field mapping for debugging
            apiMetadata.fieldMapping = {
              claims: sampleKeys.includes('Tot_Clms') ? 'Tot_Clms' : 
                     (sampleKeys.includes('total_claims') ? 'total_claims' : null),
              spending: sampleKeys.includes('Tot_Drug_Cst') ? 'Tot_Drug_Cst' : 
                       (sampleKeys.includes('total_drug_cost') ? 'total_drug_cost' : null)
            };
            
            if (!apiMetadata.fieldMapping.claims || !apiMetadata.fieldMapping.spending) {
              const warning = `Missing critical fields in API response for ${year}. Found: ${sampleKeys.join(', ')}`;
              logger.warn(warning);
              apiMetadata.warnings.push(warning);
            }
          }
          
          // Process and map the data
          const batchData = response.data.map(d => {
            // Carefully handle different field names
            const claims = parseFloat(d.Tot_Clms || d.total_claims || 0);
            const spending = parseFloat(d.Tot_Drug_Cst || d.total_drug_cost || 0);
            
            // Skip records with obviously bad data
            if (claims < 0 || spending < 0) {
              apiMetadata.warnings.push(`Skipped record with negative values: claims=${claims}, spending=${spending}`);
              return null;
            }
            
            return {
              year: parseInt(year),
              totalClaims: claims,
              totalSpending: spending,
              avgCostPerClaim: claims > 0 ? spending / claims : 0,
              brandName: d.Brnd_Name || d.brand_name || drugName,
              genericName: d.Gnrc_Name || d.generic_name || ""
            };
          }).filter(item => item !== null);
          
          allData = allData.concat(batchData);
          apiMetadata.totalRecords += batchData.length;
          
          // Check if we need more pages
          if (response.data.length < batchSize) {
            hasMoreData = false;
            logger.debug(`End of data reached for drug ${drugName}, year ${year}`);
          } else {
            pageOffset += batchSize;
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between requests
          }
        } else {
          hasMoreData = false;
          
          if (!response.data || response.data.length === 0) {
            const warning = `No data found for drug ${drugName}, year ${year}`;
            logger.warn(warning);
            apiMetadata.warnings.push(warning);
          }
        }
      } catch (requestError) {
        const errorMsg = `Error fetching drug ${drugName}, year ${year}: ${requestError.message}`;
        logger.error(errorMsg);
        apiMetadata.warnings.push(errorMsg);
        
        // Try with smaller batch on error
        if (batchSize > 100) {
          logger.info(`Retrying with smaller batch size for ${drugName}, ${year}`);
          continue;
        }
        
        hasMoreData = false;
      }
    }
    
    // Try fallback if no data found
    if (allData.length === 0) {
      apiMetadata.warnings.push(`Primary API returned no data for ${drugName}, ${year}. Trying fallback API.`);
      
      try {
        const fallbackUrl = `https://data.cms.gov/provider-summary-by-type-of-service/medicare-part-d-prescribers/medicare-part-d-prescribers-by-provider-and-drug/api/1/datastore/query?conditions[brand_name]=${encodeURIComponent(drugName)}&conditions[year]=${year}&limit=500`;
        
        logger.info(`Using fallback API for drug ${drugName}, year ${year}`);
        apiMetadata.totalRequests++;
        
        const fallbackResponse = await axios.get(fallbackUrl, { timeout: 20000 });
        apiMetadata.successfulRequests++;
        
        if (fallbackResponse.data && fallbackResponse.data.results && fallbackResponse.data.results.length > 0) {
          logger.info(`Fallback API returned ${fallbackResponse.data.results.length} records for ${drugName}, ${year}`);
          
          allData = fallbackResponse.data.results.map(d => {
            const claims = parseFloat(d.total_claim_count || d.total_claims || 0);
            const spending = parseFloat(d.total_drug_cost || d.total_spending || 0);
            
            return {
              year: parseInt(d.year || year),
              totalClaims: claims,
              totalSpending: spending,
              avgCostPerClaim: claims > 0 ? spending / claims : 0,
              brandName: d.brand_name || drugName,
              genericName: d.generic_name || ""
            };
          });
          
          apiMetadata.totalRecords = allData.length;
          apiMetadata.message = `Data retrieved from fallback API for year ${year}`;
        }
      } catch (fallbackError) {
        const errorMsg = `Fallback API failed for ${drugName}, ${year}: ${fallbackError.message}`;
        logger.error(errorMsg);
        apiMetadata.warnings.push(errorMsg);
      }
    }
    
    // Final validation
    if (allData.length > 0) {
      const totalClaims = allData.reduce((sum, item) => sum + (item.totalClaims || 0), 0);
      const totalSpending = allData.reduce((sum, item) => sum + (item.totalSpending || 0), 0);
      
      if (totalClaims === 0) {
        apiMetadata.warnings.push(`Data validation: Zero total claims for ${drugName}, ${year}`);
      }
      
      if (totalSpending === 0 && totalClaims > 0) {
        apiMetadata.warnings.push(`Data validation: Zero spending but non-zero claims for ${drugName}, ${year}`);
      }
      
      if (totalSpending > 10000000000) {
        apiMetadata.warnings.push(`Data validation: Suspiciously high spending ($${totalSpending}) for ${drugName}, ${year}`);
      }
    }
    
    // Define the result with both data and metadata
    const result = { 
      data: allData,
      metadata: apiMetadata
    };
    
    // Cache the result
    dataCache.set('partD', drugName, year, result);
    
    return result;
  } catch (error) {
    logger.error(`Critical error in fetchCmsPartDData for ${drugName}, ${year}: ${error.message}`);
    return { 
      data: [], 
      metadata: {
        dataSourceType,
        drugName,
        year,
        message: `Error: ${error.message}`,
        totalRequests: apiMetadata.totalRequests,
        successfulRequests: apiMetadata.successfulRequests,
        warnings: [...apiMetadata.warnings, error.message]
      }
    };
  }
}

/**
 * Validates CMS data for common issues
 * @param {Array} data - Processed CMS data
 * @param {string} dataType - 'partB' or 'partD'
 * @param {string} identifier - CPT code or drug name
 * @param {number} year - Service year
 * @returns {Object} Validation results with warnings
 */
function validateCmsData(data, dataType, identifier, year) {
  const warnings = [];
  
  if (!Array.isArray(data) || data.length === 0) {
    warnings.push(`No data found for ${dataType === 'partB' ? 'CPT' : 'drug'} ${identifier}, year ${year}`);
    return { isValid: false, warnings };
  }
  
  // Check for key statistics based on data type
  if (dataType === 'partB') {
    const totalImplantations = data.reduce((sum, item) => sum + (item.implantations || 0), 0);
    const totalPayment = data.reduce((sum, item) => sum + (item.totalPayment || 0), 0);
    
    if (totalImplantations === 0) {
      warnings.push(`Zero implantations for CPT ${identifier}, year ${year}`);
    }
    
    if (totalImplantations > 10000000) {
      warnings.push(`Suspiciously high implantation count (${totalImplantations}) for CPT ${identifier}, year ${year}`);
    }
    
    if (totalPayment === 0 && totalImplantations > 0) {
      warnings.push(`Zero payment but non-zero implantations for CPT ${identifier}, year ${year}`);
    }
  } else if (dataType === 'partD') {
    const totalClaims = data.reduce((sum, item) => sum + (item.totalClaims || 0), 0);
    const totalSpending = data.reduce((sum, item) => sum + (item.totalSpending || 0), 0);
    
    if (totalClaims === 0) {
      warnings.push(`Zero claims for drug ${identifier}, year ${year}`);
    }
    
    if (totalSpending === 0 && totalClaims > 0) {
      warnings.push(`Zero spending but non-zero claims for drug ${identifier}, year ${year}`);
    }
    
    if (totalSpending > 1000000000) {
      warnings.push(`Suspiciously high spending ($${totalSpending}) for drug ${identifier}, year ${year}`);
    }
  }
  
  return {
    isValid: warnings.length === 0,
    warnings
  };
}

// Helper function to find a field in an object with multiple possible names
function findField(obj, possibleNames) {
  for (const name of possibleNames) {
    if (obj[name] !== undefined) {
      return name;
    }
  }
  return null; // No matching field found
}

// Enhanced CMS Provider Data fetching
async function fetchCmsProviderData(cptCode, year) {
  // New CMS API endpoint
  const url = `https://data.cms.gov/data-api/v1/dataset/${CMS_PART_B_UUID}/data?filter[HCPCS_CODE]=${cptCode}&filter[SVC_YR]=${year}&size=5000`;
  
  try {
    const response = await axios.get(url);
    
    if (Array.isArray(response.data) && response.data.length > 0) {
      // New API format uses different field names
      return [{
        providerCount: parseInt(response.data[0].TOT_PRVDRS || 0),
        avgServicesPerProvider: response.data[0].TOT_PRVDRS > 0 ? 
          parseFloat(response.data[0].TOT_SRVCS) / parseInt(response.data[0].TOT_PRVDRS) : 0,
        totalServices: parseInt(response.data[0].TOT_SRVCS || 0),
        totalBeneficiaries: parseInt(response.data[0].TOT_BENES || 0)
      }];
    } else {
      // Try fallback API if needed
      const fallbackUrl = `https://data.cms.gov/resource/k2e6-nc2z.json?hcpcs_code=${cptCode}&year=${year}&$limit=1000`;
      
      try {
        const fallbackResponse = await axios.get(fallbackUrl);
        
        if (Array.isArray(fallbackResponse.data) && fallbackResponse.data.length > 0) {
          return fallbackResponse.data.map(d => ({
            providerCount: parseInt(d.provider_count || 0),
            avgServicesPerProvider: parseFloat(d.average_unique_beneficiaries || 0),
            specialties: d.specialty_description || "Various",
            totalServices: parseInt(d.total_services || 0)
          }));
        }
      } catch (fallbackError) {
        logger.error(`CMS Provider fallback error for ${cptCode}, ${year}: ${fallbackError.message}`);
      }
      
      return [];
    }
  } catch (error) {
    logger.error(`CMS Provider error for ${cptCode}, ${year}: ${error.message}`);
    return [];
  }
}

// Enhanced Orange Book data fetching with better error handling
async function fetchOrangeBookData(drugName) {
  const files = {
    products: 'data/products_data.json',
    patents: 'data/patent_data.json',
    exclusivity: 'data/exclusivity_data.json'
  };
  
  const results = {
    products: [],
    patents: [],
    exclusivity: [],
    summary: {}
  };

  try {
    // Ensure the data directory exists
    const dataDir = path.dirname(files.products);
    try {
      await fs.access(dataDir);
    } catch (err) {
      logger.warn(`Data directory not found, creating: ${dataDir}`);
      await fs.mkdir(dataDir, { recursive: true });
    }

    // Check and process each file
    for (const [key, filePath] of Object.entries(files)) {
      try {
        const rawData = await fs.readFile(filePath, 'utf8');
        const jsonData = JSON.parse(rawData);
        
        // Normalize search terms for case-insensitive matching
        const searchTerms = [
          drugName.toLowerCase(),
          // Add common variations (remove spaces, hyphens)
          drugName.toLowerCase().replace(/[\s-]/g, ''),
          // Add first word only for multi-word drugs
          drugName.toLowerCase().split(/\s+/)[0]
        ];
        
        // Filter data based on search terms
        results[key] = jsonData.filter(item => {
          // Check for matches in multiple fields
          const fieldsToSearch = ['Trade_Name', 'Ingredient', 'Applicant', 'Patent_No'];
          
          return fieldsToSearch.some(field => {
            if (!item[field]) return false;
            const fieldValue = item[field].toLowerCase();
            return searchTerms.some(term => fieldValue.includes(term));
          });
        });
        
        logger.info(`Found ${results[key].length} ${key} entries for ${drugName}`);
      } catch (fileError) {
        // Handle missing or invalid files gracefully
        if (fileError.code === 'ENOENT') {
          logger.warn(`Orange Book file not found: ${filePath}`);
          
          // Create empty placeholder file for future use
          const placeholderData = [];
          await fs.writeFile(filePath, JSON.stringify(placeholderData, null, 2), 'utf8');
        } else {
          logger.error(`Error processing Orange Book file ${filePath}: ${fileError.message}`);
        }
        
        results[key] = [];
      }
    }
    
    // Generate summary data
    results.summary = generateOrangeBookSummary(results);
    
    return results;
  } catch (error) {
    logger.error(`Orange Book parse error for ${drugName}: ${error.message}`);
    return { 
      products: [], 
      patents: [], 
      exclusivity: [],
      summary: {
        totalProducts: 0,
        totalPatents: 0,
        exclusivityEnd: 'Unknown',
        patentEnd: 'Unknown',
        error: error.message
      }
    };
  }
}

// Helper function to generate Orange Book summary
function generateOrangeBookSummary(orangeBookData) {
  try {
    const summary = {
      totalProducts: orangeBookData.products.length,
      totalPatents: orangeBookData.patents.length,
      totalExclusivities: orangeBookData.exclusivity.length,
      latestProduct: null,
      latestPatent: null,
      exclusivityEnd: null,
      patentEnd: null
    };
    
    // Find latest product approval
    if (orangeBookData.products.length > 0) {
      const sortedProducts = [...orangeBookData.products].sort((a, b) => {
        // Try to parse dates and compare them
        const dateA = a.Approval_Date ? new Date(a.Approval_Date) : new Date(0);
        const dateB = b.Approval_Date ? new Date(b.Approval_Date) : new Date(0);
        return dateB - dateA; // Most recent first
      });
      
      summary.latestProduct = sortedProducts[0];
    }
    
    // Find latest patent expiration
    if (orangeBookData.patents.length > 0) {
      const patentDates = orangeBookData.patents
        .filter(p => p.Patent_Expire_Date_Text)
        .map(p => ({ 
          date: new Date(p.Patent_Expire_Date_Text), 
          raw: p.Patent_Expire_Date_Text,
          number: p.Patent_No
        }))
        .filter(p => !isNaN(p.date.getTime())); // Filter out invalid dates
      
      if (patentDates.length > 0) {
        const latestPatent = patentDates.reduce((latest, current) => 
          current.date > latest.date ? current : latest, patentDates[0]);
        
        summary.patentEnd = latestPatent.raw;
        summary.latestPatentNumber = latestPatent.number;
      }
    }
    
    // Find latest exclusivity expiration
    if (orangeBookData.exclusivity.length > 0) {
      const exclusivityDates = orangeBookData.exclusivity
        .filter(e => e.Exclusivity_Date)
        .map(e => ({ 
          date: new Date(e.Exclusivity_Date), 
          raw: e.Exclusivity_Date,
          code: e.Exclusivity_Code
        }))
        .filter(e => !isNaN(e.date.getTime())); // Filter out invalid dates
      
      if (exclusivityDates.length > 0) {
        const latestExclusivity = exclusivityDates.reduce((latest, current) => 
          current.date > latest.date ? current : latest, exclusivityDates[0]);
        
        summary.exclusivityEnd = latestExclusivity.raw;
        summary.exclusivityCode = latestExclusivity.code;
      }
    }
    
    return summary;
  } catch (error) {
    logger.error(`Error generating Orange Book summary: ${error.message}`);
    return {
      totalProducts: orangeBookData.products.length,
      totalPatents: orangeBookData.patents.length,
      totalExclusivities: orangeBookData.exclusivity.length,
      error: "Error generating summary: " + error.message
    };
  }
}
async function fetchClinicalTrials(searchTerm) {
  try {
    logger.info(`Fetching clinical trials for: ${searchTerm}`);
    
    // Initialize variables for pagination
    let pageToken = null;
    const pageSize = 50; // Reasonable page size
    let totalTrials = [];
    let hasMoreResults = true;
    
    // Loop to fetch multiple pages
    while (hasMoreResults) {
      // Construct base URL
      let url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(searchTerm)}&pageSize=${pageSize}`;
      
      // Add pageToken for subsequent pages
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }
      
      logger.info(`Fetching trials matching: ${searchTerm}${pageToken ? ' (with pageToken)' : ' (first page)'}`);
      const response = await axios.get(url, { timeout: 30000 });
      
      if (response.data && response.data.studies && Array.isArray(response.data.studies)) {
        const pageResults = response.data.studies;
        logger.info(`Found ${pageResults.length} trials on this page`);
        
        // Add results to our collection
        totalTrials = [...totalTrials, ...pageResults];
        
        // Check if we have nextPageToken for pagination
        if (response.data.nextPageToken) {
          pageToken = response.data.nextPageToken;
        } else {
          // No more pages available
          hasMoreResults = false;
        }
      } else {
        // No results or unexpected format
        hasMoreResults = false;
      }
      
      // Add a small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    logger.info(`Total trials found for ${searchTerm}: ${totalTrials.length}`);
    
    // Process the results
    return totalTrials.map(study => {
      // Extract conditions data correctly
      let conditions = [];
      try {
        conditions = study.protocolSection?.conditionsModule?.conditions || [];
      } catch (e) {
        conditions = [];
      }
      
      let conditionsString = '';
      if (Array.isArray(conditions)) {
        conditionsString = conditions.join(', ');
      } else if (typeof conditions === 'string') {
        conditionsString = conditions;
      } else {
        conditionsString = 'Unknown';
      }
      
      return {
        title: study.protocolSection?.identificationModule?.briefTitle || 'Unknown Trial',
        status: study.protocolSection?.statusModule?.overallStatus || 'Unknown',
        phase: Array.isArray(study.protocolSection?.designModule?.phases) ? 
               study.protocolSection.designModule.phases[0] || 'Unknown' : 'Unknown',
        enrollment: study.protocolSection?.designModule?.enrollmentInfo?.count || 0,
        startDate: study.protocolSection?.statusModule?.startDateStruct?.date || 'N/A',
        completionDate: study.protocolSection?.statusModule?.completionDateStruct?.date || 'N/A',
        sponsor: study.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name || 'Unknown',
        conditions: conditionsString,
        nctId: study.protocolSection?.identificationModule?.nctId || 'Unknown'
      };
    });
  } catch (error) {
    logger.error(`ClinicalTrials error for ${searchTerm}: ${error.message}`);
    return [];
  }
}

// async function fetchClinicalTrials(searchTerm) {
//   const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(searchTerm)}&pageSize=10`;
//   try {
//     logger.info(`Fetching clinical trials for: ${searchTerm}`);
//     const response = await axios.get(url);
    
//     if (response.data && response.data.studies && Array.isArray(response.data.studies)) {
//       logger.info(`Found ${response.data.studies.length} clinical trials for ${searchTerm}`);
      
//       return response.data.studies.map(s => {
//         // Handle conditions properly - it might not be an array
//         let conditions = safeExtract(s, 'protocolSection.conditionsModule.conditions', []);
//         let conditionsString = '';
        
//         if (Array.isArray(conditions)) {
//           conditionsString = conditions.join(', ');
//         } else if (typeof conditions === 'string') {
//           conditionsString = conditions;
//         } else {
//           conditionsString = 'Unknown';
//         }
        
//         return {
//           title: safeExtract(s, 'protocolSection.identificationModule.briefTitle', 'Unknown Trial'),
//           status: safeExtract(s, 'protocolSection.statusModule.overallStatus', 'Unknown'),
//           phase: safeExtract(s, 'protocolSection.designModule.phases.0', 'Unknown'),
//           enrollment: safeExtract(s, 'protocolSection.designModule.enrollmentInfo.count', 0),
//           startDate: safeExtract(s, 'protocolSection.statusModule.startDateStruct.date', 'N/A'),
//           completionDate: safeExtract(s, 'protocolSection.statusModule.completionDateStruct.date', 'N/A'),
//           sponsor: safeExtract(s, 'protocolSection.sponsorCollaboratorsModule.leadSponsor.name', 'Unknown'),
//           conditions: conditionsString,
//           nctId: safeExtract(s, 'protocolSection.identificationModule.nctId', 'Unknown')
//         };
//       });
//     } else {
//       logger.warn(`No clinical trials found for ${searchTerm}`);
//       return [];
//     }
//   } catch (error) {
//     logger.error(`ClinicalTrials error for ${searchTerm}: ${error.message}`);
//     return [];
//   }
// }
// SEC API implementation based on official SEC.gov documentation
async function fetchSecFilings(cik) {
  if (!cik) {
    logger.info('No CIK provided, skipping SEC data fetch');
    return [];
  }
  
  // Ensure CIK is properly formatted as 10 digits with leading zeros
  const formattedCik = cik.padStart(10, '0');
  
  try {
    logger.info(`Fetching SEC filings for CIK: ${formattedCik}`);
    
    // Use the exact URL format from SEC documentation
    const submissionsUrl = `https://data.sec.gov/submissions/CIK${formattedCik}.json`;
    
    const response = await axios.get(submissionsUrl, {
      headers: { 
        // SEC requires a proper User-Agent header
        'User-Agent': 'EpilepsyMedtechCompetitorAnalysis (compliance@example.com)',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    // Process the submission data according to documented structure
    if (response.data) {
      logger.info(`Successfully retrieved SEC data for CIK ${formattedCik}`);
      
      // Extract company information
      const entityInfo = {
        cik: response.data.cik || cik,
        entityName: response.data.name || 'Unknown',
        sic: response.data.sic || 'Unknown',
        sicDescription: response.data.sicDescription || 'Unknown',
        exchanges: response.data.exchanges || [],
        tickers: response.data.tickers || []
      };
      
      // Process recent filings if available
      let filings = [];
      
      if (response.data.filings && response.data.filings.recent) {
        const recentFilings = response.data.filings.recent;
        
        // Check if all required arrays are present and have the same length
        if (recentFilings.accessionNumber && 
            recentFilings.form && 
            recentFilings.filingDate && 
            recentFilings.accessionNumber.length === recentFilings.form.length) {
          
          // Structure is as expected, process the filings
          const filingCount = recentFilings.accessionNumber.length;
          logger.info(`Found ${filingCount} recent filings`);
          
          // Create an array of filing objects from the columnar data
          for (let i = 0; i < filingCount; i++) {
            // Only include important filing types
            if (['10-K', '10-Q', '8-K', '20-F', '40-F', '6-K'].includes(recentFilings.form[i])) {
              filings.push({
                form: recentFilings.form[i],
                description: getFormDescription(recentFilings.form[i]),
                filingDate: recentFilings.filingDate[i],
                reportDate: recentFilings.reportDate?.[i] || recentFilings.filingDate[i],
                accessionNumber: recentFilings.accessionNumber[i],
                fileNumber: recentFilings.fileNumber?.[i] || 'Unknown',
                items: recentFilings.items?.[i] || [],
                size: recentFilings.size?.[i] || 0,
                isXBRL: recentFilings.isXBRL?.[i] === 1,
                isInlineXBRL: recentFilings.isInlineXBRL?.[i] === 1,
                primaryDocument: recentFilings.primaryDocument?.[i] || '',
                primaryDocDescription: recentFilings.primaryDocDescription?.[i] || '',
                entityName: entityInfo.entityName,
                cik: cik,
                // Format URL according to SEC standards
                url: recentFilings.primaryDocument?.[i] ?
                  `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}/${recentFilings.accessionNumber[i].replace(/-/g, '')}/${recentFilings.primaryDocument[i]}` :
                  `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}/${recentFilings.accessionNumber[i].replace(/-/g, '')}`
              });
            }
          }
          
          // Sort by filing date (newest first)
          filings.sort((a, b) => new Date(b.filingDate) - new Date(a.filingDate));
          
          // Limit to 10 most recent filings
          filings = filings.slice(0, 10);
        } else {
          logger.warn(`Unexpected structure in recent filings data for CIK ${formattedCik}`);
        }
      }
      
      // If we didn't get filings from the recent array, check if there are files to process
      if (filings.length === 0 && response.data.filings && response.data.filings.files) {
        logger.info(`No recent filings found, checking files array`);
        
        // TODO: Process additional filing history from the files array if needed
        // This would require additional API calls to each file referenced
      }
      
      // If we still have no filings, try the company facts API for additional information
      if (filings.length === 0) {
        logger.info(`No filings found in submissions API, trying company facts API`);
        
        try {
          const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${formattedCik}.json`;
          
          const factsResponse = await axios.get(factsUrl, {
            headers: { 
              'User-Agent': 'EpilepsyMedtechCompetitorAnalysis (compliance@example.com)',
              'Accept': 'application/json'
            },
            timeout: 15000
          });
          
          if (factsResponse.data && factsResponse.data.entityName) {
            logger.info(`Found company facts data for ${factsResponse.data.entityName}`);
            
            // Create a placeholder filing with company facts information
            filings.push({
              form: "Company Facts",
              description: "Financial data available via XBRL",
              filingDate: new Date().toISOString().split('T')[0],
              reportDate: "See SEC website for details",
              accessionNumber: "XBRL-Facts",
              entityName: factsResponse.data.entityName,
              cik: cik,
              url: `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`
            });
          }
        } catch (factsError) {
          logger.error(`Company facts API error: ${factsError.message}`);
        }
      }
      
      // Return filings along with company information
      if (filings.length > 0) {
        // Add entity info to each filing
        filings.forEach(filing => {
          filing.entityInfo = entityInfo;
        });
        
        return filings;
      } else {
        logger.warn(`No filings found for CIK ${formattedCik} in any API`);
        
        // Return a placeholder with the entity information
        return [{
          form: "SEC Entity",
          description: "Company registered with SEC",
          filingDate: new Date().toISOString().split('T')[0],
          reportDate: "See SEC website for details",
          accessionNumber: "Entity-Info",
          entityName: entityInfo.entityName,
          cik: cik,
          entityInfo: entityInfo,
          url: `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`
        }];
      }
    } else {
      logger.warn(`Empty response from SEC API for CIK ${formattedCik}`);
      return [];
    }
  } catch (error) {
    logger.error(`SEC API error for CIK ${formattedCik}: ${error.message}`);
    
    // Try company facts API as fallback if submissions API fails
    try {
      logger.info(`Trying company facts API for CIK ${formattedCik}`);
      const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${formattedCik}.json`;
      
      const factsResponse = await axios.get(factsUrl, {
        headers: { 
          'User-Agent': 'EpilepsyMedtechCompetitorAnalysis (compliance@example.com)',
          'Accept': 'application/json'
        },
        timeout: 15000
      });
      
      if (factsResponse.data && factsResponse.data.entityName) {
        logger.info(`Found company facts data for ${factsResponse.data.entityName}`);
        
        return [{
          form: "Company Facts",
          description: "Financial data available via XBRL",
          filingDate: new Date().toISOString().split('T')[0],
          reportDate: "See SEC website for details",
          accessionNumber: "XBRL-Facts",
          entityName: factsResponse.data.entityName,
          cik: cik,
          url: `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`
        }];
      }
    } catch (factsError) {
      logger.error(`Company facts API error: ${factsError.message}`);
    }
    
    // Return an empty array if all attempts fail
    return [];
  }
}




// async function fetchSecFilings(cik) {
//   const url = `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`;
  
//   try {
//     logger.info(`Fetching SEC filings for CIK: ${cik}`);
    
//     const response = await axios.get(url, {
//       headers: { 
//         'User-Agent': 'EpilepsyMedtechCompetitorAnalysis (compliance@example.com)',
//         'Accept': 'application/json'
//       },
//       timeout: 15000
//     });
    
//     if (response.data && response.data.filings && response.data.filings.recent) {
//       // Get recent filings and focus on important types like 10-K, 10-Q, 8-K
//       const importantFilings = response.data.filings.recent.entries
//         .filter(f => ['10-K', '10-Q', '8-K', '20-F', '6-K'].includes(f.form))
//         .slice(0, 10);
      
//       logger.info(`Found ${importantFilings.length} important SEC filings for CIK ${cik}`);
      
//       return importantFilings.map(f => ({
//         form: f.form,
//         description: getFormDescription(f.form),
//         filingDate: f.filingDate,
//         reportDate: f.reportDate || f.filingDate,
//         accessionNumber: f.accessionNumber,
//         documentCount: f.documentsCount || 0,
//         size: f.size || 'Unknown',
//         url: `https://www.sec.gov/Archives/edgar/data/${cik}/${f.accessionNumber.replace(/-/g, '')}/${f.primaryDocument}`
//       }));
//     } else {
//       logger.warn(`No SEC filings found for CIK ${cik}`);
      
//       // Try alternate API endpoint through EDGAR search
//       try {
//         const alternateUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K,10-Q&output=atom`;
//         logger.info(`Trying alternate SEC endpoint for CIK ${cik}`);
        
//         const alternateResponse = await axios.get(alternateUrl, {
//           headers: { 
//             'User-Agent': 'EpilepsyMedtechCompetitorAnalysis (compliance@example.com)'
//           }
//         });
        
//         // This returns XML/Atom format, so we'll need to extract data differently
//         // For now, return a placeholder indicating data is available but requires different processing
//         if (alternateResponse.data && alternateResponse.data.includes('<entry>')) {
//           return [{
//             form: "SEC Filings",
//             description: "SEC filings found via alternate API",
//             filingDate: new Date().toISOString().split('T')[0],
//             reportDate: new Date().toISOString().split('T')[0],
//             accessionNumber: "Alternate-API",
//             url: `https://www.sec.gov/cgi-bin/browse-edgar?CIK=${cik}`
//           }];
//         }
//       } catch (alternateError) {
//         logger.error(`SEC alternate endpoint error: ${alternateError.message}`);
//       }
      
//       return [];
//     }
//   } catch (error) {
//     logger.error(`SEC error for CIK ${cik}: ${error.message}`);
    
//     // Try alternate approach
//     try {
//       // Use company name lookup if direct CIK fails
//       const competitor = competitors.find(c => c.cik === cik);
      
//       if (competitor) {
//         const nameSearchUrl = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(competitor.name)}&owner=exclude&action=getcompany`;
//         logger.info(`Trying SEC name search for ${competitor.name}`);
        
//         // This approach requires HTML parsing which is complex
//         // Return a placeholder for now
//         return [{
//           form: "SEC Filings",
//           description: "Available via company name search",
//           filingDate: new Date().toISOString().split('T')[0],
//           reportDate: "Unknown",
//           url: nameSearchUrl
//         }];
//       }
//     } catch (nameError) {
//       logger.error(`SEC name search error: ${nameError.message}`);
//     }
    
//     return [];
//   }
// }

// Helper function to provide descriptions for SEC form types
function getFormDescription(formType) {
  const descriptions = {
    '10-K': 'Annual Report',
    '10-Q': 'Quarterly Report',
    '8-K': 'Current Report (Material Event)',
    '20-F': 'Annual Report (Foreign)',
    '6-K': 'Current Report (Foreign)',
    'S-1': 'Initial Registration',
    'S-4': 'Merger/Acquisition',
    '424B': 'Prospectus',
    'DEF 14A': 'Proxy Statement'
  };
  
  return descriptions[formType] || 'SEC Filing';
}

// Fixed analyzeImplantationTrends function to correctly process CMS data
function analyzeImplantationTrends(cmsData) {
  logger.info(`Analyzing implantation trends from ${cmsData.length} CMS records`);
  
  // Debug the incoming data structure
  if (cmsData.length > 0) {
    logger.debug(`Sample CMS data structure: ${JSON.stringify(cmsData[0])}`);
  }
  
  const trends = {};
  
  // Initialize trends for each competitor to avoid missing data
  competitors.filter(c => c.type === 'device').forEach(comp => {
    trends[comp.name] = {
      2020: 0,
      2021: 0,
      2022: 0
    };
  });
  
  // Process the actual data
  cmsData.forEach(entry => {
    if (!entry) return; // Skip null/undefined entries
    
    const { competitor, year, implantations } = entry;
    
    if (!competitor || !year || implantations === undefined) {
      logger.warn(`Skipping incomplete CMS entry: ${JSON.stringify(entry)}`);
      return;
    }
    
    if (!trends[competitor]) {
      logger.warn(`Initializing missing competitor in trends: ${competitor}`);
      trends[competitor] = {
        2020: 0,
        2021: 0,
        2022: 0
      };
    }
    
    trends[competitor][year] = (trends[competitor][year] || 0) + implantations;
  });
  
  const years = [2020, 2021, 2022]; // Use fixed years for consistency
  
  // Log the final trend data for debugging
  logger.info(`Final implantation trends: ${JSON.stringify(trends)}`);
  
  return {
    labels: years,
    datasets: Object.keys(trends).map(name => ({
      label: `${name} Implantations`,
      data: years.map(y => trends[name][y] || 0)
    }))
  };
}

function analyzeReimbursementTrends(cmsData) {
  logger.info(`Analyzing reimbursement trends from ${cmsData.length} CMS records`);
  
  const trends = {};
  
  // Initialize trends for each competitor to avoid missing data
  competitors.filter(c => c.type === 'device').forEach(comp => {
    trends[comp.name] = {
      2020: 0,
      2021: 0,
      2022: 0
    };
  });
  
  // Track total payments and service counts to calculate weighted averages
  const totals = {};
  competitors.filter(c => c.type === 'device').forEach(comp => {
    totals[comp.name] = {
      2020: { payments: 0, services: 0 },
      2021: { payments: 0, services: 0 },
      2022: { payments: 0, services: 0 }
    };
  });
  
  // Process the actual data
  cmsData.forEach(entry => {
    if (!entry) return; // Skip null/undefined entries
    
    const { competitor, year, avgPayment, implantations } = entry;
    
    if (!competitor || !year || avgPayment === undefined || implantations === undefined) {
      return;
    }
    
    if (!totals[competitor]) {
      totals[competitor] = {
        2020: { payments: 0, services: 0 },
        2021: { payments: 0, services: 0 },
        2022: { payments: 0, services: 0 }
      };
    }
    
    // Add to the running totals (weighted sum)
    totals[competitor][year].payments += avgPayment * implantations;
    totals[competitor][year].services += implantations;
  });
  
  // Calculate weighted averages
  Object.keys(totals).forEach(competitor => {
    Object.keys(totals[competitor]).forEach(year => {
      const { payments, services } = totals[competitor][year];
      trends[competitor][year] = services > 0 ? payments / services : 0;
    });
  });
  
  const years = [2020, 2021, 2022]; // Use fixed years for consistency
  
  // Log the final trend data for debugging
  logger.info(`Final reimbursement trends: ${JSON.stringify(trends)}`);
  
  return {
    labels: years,
    datasets: Object.keys(trends).map(name => ({
      label: `${name} Avg Reimbursement`,
      data: years.map(y => Math.round(trends[name][y] * 100) / 100)
    }))
  };
}

function estimateMarketShare(cmsData, refractoryPopulation = 1000000) {
  logger.info(`Estimating market share from ${cmsData.length} CMS records`);
  
  // Get all unique years in the data
  const years = [...new Set(cmsData.map(d => d.year))].sort();
  const latestYear = years.length > 0 ? Math.max(...years) : 2022;
  
  // Get data for the latest year
  const latestData = cmsData.filter(d => d.year === latestYear);
  
  // Calculate total implants by competitor for the latest year
  const competitorImplants = {};
  latestData.forEach(d => {
    if (d.competitor && d.implantations !== undefined) {
      competitorImplants[d.competitor] = (competitorImplants[d.competitor] || 0) + d.implantations;
    }
  });
  
  // Calculate the total implants across all competitors
  const totalImplants = Object.values(competitorImplants).reduce((sum, val) => sum + val, 0);
  
  // Calculate market shares
  const shares = {};
  Object.entries(competitorImplants).forEach(([competitor, implantations]) => {
    shares[competitor] = {
      competitorPercentage: totalImplants > 0 ? 
        ((implantations / totalImplants) * 100).toFixed(2) : "0.00",
      refractoryShare: ((implantations / refractoryPopulation) * 100).toFixed(4),
      implantations,
      year: latestYear
    };
  });
  
  // Log the share calculations for debugging
  logger.info(`Market share calculation: total implants = ${totalImplants}`);
  logger.info(`Market shares by competitor: ${JSON.stringify(shares)}`);
  
  return {
    shares,
    totalMarket: totalImplants,
    latestYear,
    estimatedPenetration: ((totalImplants / refractoryPopulation) * 100).toFixed(2),
    refractoryPopulation
  };
}

function analyzeTrialActivity(trialData) {
  // Analyze by status
  const statusCounts = trialData.reduce((acc, trial) => {
    acc[trial.status] = (acc[trial.status] || 0) + 1;
    return acc;
  }, {});
  
  // Analyze by phase
  const phaseCounts = trialData.reduce((acc, trial) => {
    const phase = trial.phase || 'Unknown';
    acc[phase] = (acc[phase] || 0) + 1;
    return acc;
  }, {});
  
  // Analyze by sponsor
  const sponsorCounts = trialData.reduce((acc, trial) => {
    const sponsor = trial.sponsor || 'Unknown';
    acc[sponsor] = (acc[sponsor] || 0) + 1;
    return acc;
  }, {});
  
  // Analyze by year
  const yearCounts = trialData.reduce((acc, trial) => {
    if (trial.startDate && trial.startDate !== 'N/A') {
      const year = trial.startDate.substring(0, 4);
      acc[year] = (acc[year] || 0) + 1;
    }
    return acc;
  }, {});
  
  return {
    statusAnalysis: {
      labels: Object.keys(statusCounts),
      datasets: [{ label: "Trial Status", data: Object.values(statusCounts) }]
    },
    phaseAnalysis: {
      labels: Object.keys(phaseCounts),
      datasets: [{ label: "Trial Phase", data: Object.values(phaseCounts) }]
    },
    sponsorAnalysis: {
      labels: Object.keys(sponsorCounts).slice(0, 10), // Top 10 sponsors
      datasets: [{ label: "Sponsors", data: Object.values(sponsorCounts).slice(0, 10) }]
    },
    yearAnalysis: {
      labels: Object.keys(yearCounts).sort(),
      datasets: [{ label: "Trials by Start Year", data: Object.keys(yearCounts).sort().map(y => yearCounts[y]) }]
    },
    totalTrials: trialData.length,
    activeTrials: trialData.filter(t => ['Recruiting', 'Not yet recruiting', 'Active, not recruiting'].includes(t.status)).length
  };
}

function analyzeDrugSpending(cmsData) {
  const trends = {};
  cmsData.forEach(entry => {
    const { competitor, year, totalSpending } = entry;
    if (!trends[competitor]) trends[competitor] = {};
    trends[competitor][year] = totalSpending;
  });
  const years = [...new Set(cmsData.map(d => d.year))].sort();
  
  // Also calculate total market and share percentages
  const marketTotals = {};
  years.forEach(year => {
    marketTotals[year] = cmsData
      .filter(d => d.year === year)
      .reduce((sum, d) => sum + d.totalSpending, 0);
  });
  
  const marketShare = {};
  Object.keys(trends).forEach(competitor => {
    marketShare[competitor] = {};
    years.forEach(year => {
      if (marketTotals[year] > 0 && trends[competitor][year]) {
        marketShare[competitor][year] = (trends[competitor][year] / marketTotals[year] * 100).toFixed(2);
      } else {
        marketShare[competitor][year] = 0;
      }
    });
  });
  
  return {
    spending: {
      labels: years,
      datasets: Object.keys(trends).map(name => ({
        label: `${name} Spending`,
        data: years.map(y => trends[name][y] || 0)
      }))
    },
    share: {
      labels: years,
      datasets: Object.keys(marketShare).map(name => ({
        label: `${name} Market Share %`,
        data: years.map(y => marketShare[name][y] || 0)
      }))
    },
    marketTotals: {
      labels: years,
      datasets: [{
        label: 'Total Market Size',
        data: years.map(y => marketTotals[y])
      }]
    }
  };
}

// API Routes
app.get('/api/competitors', (req, res) => {
  res.json(competitors.map(c => ({
    name: c.name,
    type: c.type,
    treatment: c.treatment,
    cik: c.cik || null,
    hasSecData: !!c.cik
  })));
});

// FDA Data Endpoint
app.get('/api/fda/:name', async (req, res) => {
  const name = req.params.name;
  const competitor = competitors.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!competitor) {
      return res.status(404).json({ error: 'Competitor not found' });
  }
  try {
      const fdaData = await fetchFdaData(competitor.keywords[0], competitor.type);
      res.json(fdaData);
  } catch (error) {
      logger.error(`Error fetching FDA data for ${name}: ${error.message}`);
      res.status(500).json({ error: error.message });
  }
});

// Patents Endpoint
app.get('/api/patents/:name', async (req, res) => {
  const name = req.params.name;
  const competitor = competitors.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!competitor) {
      return res.status(404).json({ error: 'Competitor not found' });
  }
  try {
      const patents = await fetchPatents(competitor.keywords[0]);
      res.json(patents);
  } catch (error) {
      logger.error(`Error fetching patents for ${name}: ${error.message}`);
      res.status(500).json({ error: error.message });
  }
});

app.get('/api/competitors/:name', async (req, res) => {
  const competitor = competitors.find(c => c.name === req.params.name);
  if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

  const data = { 
    name: competitor.name, 
    type: competitor.type, 
    treatment: competitor.treatment,
    requestTimestamp: new Date().toISOString() 
  };

  // Use Promise.allSettled to fetch all data concurrently
  const promises = [];
  const results = {};

  // FDA Approvals Promise
  promises.push(
    fetchFdaData(competitor.treatment, competitor.type)
      .then(result => {
        results.fdaApprovals = result;
      })
      .catch(error => {
        logger.error(`FDA data error: ${error.message}`);
        results.fdaApprovals = { 
          endpoints: {}, 
          combinedResults: [],
          error: error.message
        };
      })
  );

  // CMS Data Promises
  if (competitor.type === 'device') {
    results.cmsPartB = {};
    
    // Collect all CMS data fetching promises
    const cmsPromises = [];
    
    for (const code of competitor.cptCodes || []) {
      for (const year of [2020, 2021, 2022]) {
        cmsPromises.push(
          fetchCmsPartBData(code, year)
            .then(result => {
              results.cmsPartB[`${code}-${year}`] = result;
            })
            .catch(error => {
              logger.error(`CMS Part B error for ${code}-${year}: ${error.message}`);
              results.cmsPartB[`${code}-${year}`] = [];
            })
        );
      }
    }
    
    // Add combined CMS promise to main promises array
    promises.push(Promise.allSettled(cmsPromises));
    
  } else if (competitor.type === 'drug') {
    results.cmsPartD = {};
    
    // Fetch drug data for each year
    const cmsPromises = [];
    
    for (const year of [2020, 2021, 2022]) {
      cmsPromises.push(
        fetchCmsPartDData(competitor.treatment, year)
          .then(cmsData => {
            // For API response, include both summary and limited data
            results.cmsPartD[year] = {
              summary: {
                recordCount: cmsData.length,
                totalSpending: cmsData.reduce((sum, item) => sum + (item.totalSpending || 0), 0),
                totalClaims: cmsData.reduce((sum, item) => sum + (item.totalClaims || 0), 0),
                avgCostPerClaim: cmsData.length > 0 ? 
                  cmsData.reduce((sum, item) => sum + (item.totalSpending || 0), 0) / 
                  cmsData.reduce((sum, item) => sum + (item.totalClaims || 0), 1) : 0,
                topSpecialties: getTopValues(cmsData, 'specialty', 5),
                topProviderTypes: getTopValues(cmsData, 'providerType', 5)
              },
              // Only include a small sample of records
              sampleRecords: cmsData.slice(0, 10)
            };
          })
          .catch(error => {
            logger.error(`CMS Part D error for ${year}: ${error.message}`);
            results.cmsPartD[year] = {
              summary: { error: error.message },
              sampleRecords: []
            };
          })
      );
    }
    
    // Add combined CMS promise to main promises array
    promises.push(Promise.allSettled(cmsPromises));
  }

  // Orange Book Promise (for drugs)
  if (competitor.type === 'drug') {
    promises.push(
      fetchOrangeBookData(competitor.treatment)
        .then(result => {
          results.orangeBook = result;
        })
        .catch(error => {
          logger.error(`Orange Book error: ${error.message}`);
          results.orangeBook = { 
            products: [], 
            patents: [], 
            exclusivity: [],
            summary: { error: error.message }
          };
        })
    );
  }

  // Clinical Trials Promise
  promises.push(
    fetchClinicalTrials(competitor.keywords[0])
      .then(result => {
        results.clinicalTrials = result;
      })
      .catch(error => {
        logger.error(`Clinical Trials error: ${error.message}`);
        results.clinicalTrials = [];
      })
  );

  // Patents Promise
  promises.push(
    fetchPatents(competitor.name)
      .then(result => {
        results.patents = result;
      })
      .catch(error => {
        logger.error(`Patents error: ${error.message}`);
        results.patents = [];
      })
  );

  // SEC Filings Promise (for public companies)
  if (competitor.cik) {
    promises.push(
      fetchSecFilings(competitor.cik)
        .then(result => {
          results.secFilings = result;
        })
        .catch(error => {
          logger.error(`SEC Filings error: ${error.message}`);
          results.secFilings = [];
        })
    );
  }

  try {
    // Wait for all promises to settle
    await Promise.allSettled(promises);
    
    // Add all results to the response
    Object.assign(data, results);
    
    // Add summary metrics
    data.summary = generateCompetitorSummary(competitor, results);
    
    res.json(data);
  } catch (error) {
    logger.error(`General error in competitor data fetch: ${error.message}`);
    res.status(500).json({ 
      error: 'Error fetching competitor data', 
      message: error.message,
      partialData: Object.assign({}, data, results) // Include any partial data
    });
  }
});

// Helper function to generate summary metrics for a competitor
function generateCompetitorSummary(competitor, results) {
  const summary = {
    type: competitor.type,
    fdaStatus: "Unknown",
    marketMetrics: {},
    clinicalActivity: {},
    intellectualProperty: {},
    cik: competitor.cik || null, // Always include CIK in summary
    hasSecData: !!competitor.cik
  };
  
  // FDA status summary
  if (results.fdaApprovals) {
    const approvalEndpoints = results.fdaApprovals.endpoints || {};
    const combinedResults = results.fdaApprovals.combinedResults || [];
    
    summary.fdaStatus = combinedResults.length > 0 ? 
      "Data available" : "No FDA data found";
    
    summary.fdaEndpoints = Object.keys(approvalEndpoints)
      .filter(endpoint => approvalEndpoints[endpoint].status === "success")
      .join(", ") || "None successful";
  }
  
  // Market metrics
  if (competitor.type === 'device' && results.cmsPartB) {
    const cmsData = [];
    
    // Flatten CMS data for analysis
    Object.entries(results.cmsPartB).forEach(([key, data]) => {
      if (key.includes("provider")) return; // Skip provider data for this analysis
      
      if (Array.isArray(data)) {
        data.forEach(d => {
          d.competitor = competitor.name;
          cmsData.push(d);
        });
      }
    });
    
    // Get latest year
    const years = cmsData.map(d => d.year).filter(Boolean);
    const latestYear = years.length > 0 ? Math.max(...years) : null;
    
    // Calculate total implantations and spending
    const totalImplantations = cmsData.reduce((sum, d) => sum + (d.implantations || 0), 0);
    const totalSpending = cmsData.reduce((sum, d) => sum + (d.totalPayment || 0), 0);
    
    summary.marketMetrics = {
      totalImplantations,
      totalSpending: Math.round(totalSpending * 100) / 100,
      latestYear,
      cptCodes: competitor.cptCodes?.join(", ") || "None specified"
    };
    
  } else if (competitor.type === 'drug' && results.cmsPartD) {
    const yearSummaries = {};
    let totalSpending = 0;
    let totalClaims = 0;
    
    // Collect data from all years
    Object.entries(results.cmsPartD).forEach(([year, data]) => {
      if (data && data.summary) {
        yearSummaries[year] = {
          spending: data.summary.totalSpending || 0,
          claims: data.summary.totalClaims || 0
        };
        
        totalSpending += data.summary.totalSpending || 0;
        totalClaims += data.summary.totalClaims || 0;
      }
    });
    
    summary.marketMetrics = {
      totalSpending: Math.round(totalSpending * 100) / 100,
      totalClaims,
      yearlyData: yearSummaries,
      avgCostPerClaim: totalClaims > 0 ? Math.round((totalSpending / totalClaims) * 100) / 100 : 0
    };
  }
  
  // Clinical activity
  if (results.clinicalTrials && Array.isArray(results.clinicalTrials)) {
    const activeTrials = results.clinicalTrials.filter(t => 
      ['Recruiting', 'Enrolling by invitation', 'Active, not recruiting', 'Not yet recruiting'].includes(t.status)
    ).length;
    
    const completedTrials = results.clinicalTrials.filter(t => 
      ['Completed'].includes(t.status)
    ).length;
    
    summary.clinicalActivity = {
      totalTrials: results.clinicalTrials.length,
      activeTrials,
      completedTrials,
      otherStatus: results.clinicalTrials.length - activeTrials - completedTrials
    };
  }
  
  // Intellectual property
  if (results.patents) {
    const patentCount = Array.isArray(results.patents) ? results.patents.length : 0;
    
    summary.intellectualProperty = {
      patentCount,
      patentsAvailable: patentCount > 0
    };
    
    // Add Orange Book data for drugs
    if (competitor.type === 'drug' && results.orangeBook) {
      summary.intellectualProperty.orangeBook = {
        products: results.orangeBook.products?.length || 0,
        patents: results.orangeBook.patents?.length || 0,
        exclusivities: results.orangeBook.exclusivity?.length || 0
      };
      
      if (results.orangeBook.summary) {
        summary.intellectualProperty.orangeBook.exclusivityEnd = results.orangeBook.summary.exclusivityEnd;
        summary.intellectualProperty.orangeBook.patentEnd = results.orangeBook.summary.patentEnd;
      }
    }
  }
  
  // SEC filings (for public companies)
  if (competitor.cik && results.secFilings) {
    const filingCount = Array.isArray(results.secFilings) ? results.secFilings.length : 0;
    const latestFiling = filingCount > 0 ? results.secFilings[0] : null;
    
    summary.financials = {
      filingCount,
      latestFilingDate: latestFiling?.filingDate || 'Unknown',
      latestFilingType: latestFiling?.form || 'Unknown',
      cik: competitor.cik,
      secUrl: filingCount > 0 ? 
      `https://www.sec.gov/cgi-bin/browse-edgar?CIK=${competitor.cik.replace(/^0+/, '')}&owner=exclude&action=getcompany` : 
      null
    };
  }
  
  return summary;
}

// Helper function to get top values from dataset
function getTopValues(data, field, limit = 5) {
  // Count occurrences of each value
  const counts = {};
  
  data.forEach(item => {
    const value = item[field] || 'Unknown';
    counts[value] = (counts[value] || 0) + 1;
  });
  
  // Convert to array and sort by count
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

/**
 * Simulates data for years without real data based on existing years
 * @param {string} type - 'partB' or 'partD'
 * @param {string} code - CPT code or drug name
 * @param {Object} baseData - Real data from most recent confirmed year
 * @param {number} targetYear - Year to simulate data for
 * @param {number} growthRate - Annual growth rate to apply (%)
 * @returns {Object} Simulated data with metadata
 */
function simulateYearData(type, code, baseData, targetYear, growthRate) {
  if (!baseData || !baseData.data || baseData.data.length === 0) {
    return {
      data: [],
      metadata: {
        dataSourceType: 'simulated',
        [type === 'partB' ? 'cptCode' : 'drugName']: code,
        year: targetYear,
        message: `Simulation failed: No base data available to project from`,
        isSimulated: true,
        warnings: ['No real data available to use as simulation base']
      }
    };
  }
  
  const baseYear = baseData.metadata.year;
  const yearDiff = targetYear - baseYear;
  
  if (yearDiff <= 0) {
    return {
      data: baseData.data,
      metadata: baseData.metadata
    };
  }
  
  logger.info(`Simulating ${type} data for ${code}, year ${targetYear} based on ${baseYear} data with ${growthRate}% annual growth`);
  
  // Calculate compound growth over the year difference
  const compoundGrowthFactor = Math.pow(1 + (growthRate / 100), yearDiff);
  
  // Clone and adjust the data based on type
  let simulatedData = [];
  
  if (type === 'partB') {
    simulatedData = baseData.data.map(record => {
      const projectedImplantations = Math.round(record.implantations * compoundGrowthFactor);
      // Assume payment increases slightly faster than implantations (healthcare inflation)
      const projectedAvgPayment = record.avgPayment * Math.pow(1 + ((growthRate + 1.5) / 100), yearDiff);
      
      return {
        ...record,
        year: targetYear,
        implantations: projectedImplantations,
        avgPayment: projectedAvgPayment,
        totalPayment: projectedImplantations * projectedAvgPayment
      };
    });
  } else if (type === 'partD') {
    simulatedData = baseData.data.map(record => {
      const projectedClaims = Math.round(record.totalClaims * compoundGrowthFactor);
      // Assume drug costs increase faster than claims volume (pharmaceutical inflation)
      const projectedSpending = record.totalSpending * Math.pow(1 + ((growthRate + 2.0) / 100), yearDiff);
      
      return {
        ...record,
        year: targetYear,
        totalClaims: projectedClaims,
        totalSpending: projectedSpending,
        avgCostPerClaim: projectedClaims > 0 ? projectedSpending / projectedClaims : 0
      };
    });
  }
  
  return {
    data: simulatedData,
    metadata: {
      dataSourceType: 'simulated',
      [type === 'partB' ? 'cptCode' : 'drugName']: code,
      year: targetYear,
      baseYear,
      message: `Simulated data for ${targetYear} based on ${baseYear} with ${growthRate}% annual growth`,
      isSimulated: true,
      simulationMethod: 'compound-growth',
      growthRate,
      compoundGrowthFactor,
      warnings: []
    }
  };
}

/**
 * Gets data for a specific year, either from real API data or simulation
 * @param {string} type - 'partB' or 'partD'
 * @param {string} code - CPT code or drug name
 * @param {number} year - Target year
 * @param {number} customGrowthRate - Optional custom growth rate
 * @returns {Promise<Object>} Data with source metadata
 */
async function getYearData(type, code, year, customGrowthRate) {
  // First try to get real data for this year
  let dataResult;
  
  if (type === 'partB') {
    dataResult = await fetchCmsPartBData(code, year);
  } else if (type === 'partD') {
    dataResult = await fetchCmsPartDData(code, year);
  } else {
    throw new Error(`Invalid data type: ${type}`);
  }
  
  // If this is a simulated year or no data was found, we need to simulate
  if (dataResult.metadata.dataSourceType === 'simulated' || dataResult.data.length === 0) {
    // Find the most recent year with real data to use as base
    let baseData = null;
    let baseYear = null;
    
    // Try each confirmed year in descending order
    for (const testYear of [...YEAR_CONFIG.confirmedDataYears].sort((a, b) => b - a)) {
      if (type === 'partB') {
        baseData = await fetchCmsPartBData(code, testYear);
      } else {
        baseData = await fetchCmsPartDData(code, testYear);
      }
      
      if (baseData.data && baseData.data.length > 0) {
        baseYear = testYear;
        break;
      }
    }
    
    if (!baseData || !baseData.data || baseData.data.length === 0) {
      return {
        data: [],
        metadata: {
          dataSourceType: 'missing',
          [type === 'partB' ? 'cptCode' : 'drugName']: code,
          year,
          message: `No data available for ${code} in any year`,
          warnings: ['No historical data available for simulation']
        }
      };
    }
    
    // Determine growth rate to use
    let growthRate;
    
    if (customGrowthRate !== undefined) {
      growthRate = customGrowthRate;
    } else {
      // Try to find competitor-specific growth rate
      const competitor = competitors.find(c => {
        if (type === 'partB') {
          return c.type === 'device' && c.cptCodes && c.cptCodes.includes(code);
        } else {
          return c.type === 'drug' && c.name === code;
        }
      });
      
      if (competitor && competitor.industryGrowth) {
        growthRate = competitor.industryGrowth;
      } else {
        // Use default growth rate for the metric
        if (type === 'partB') {
          growthRate = YEAR_CONFIG.defaultGrowthRates.implantations;
        } else {
          growthRate = YEAR_CONFIG.defaultGrowthRates.spending;
        }
      }
    }
    
    // Simulate data
    return simulateYearData(type, code, baseData, year, growthRate);
  }
  
  // Otherwise return the real data
  return dataResult;
}

/**
 * Calculate aggregate metrics for multiple records
 * @param {Array} data - Array of data records
 * @param {string} type - 'partB' or 'partD'
 * @returns {Object} Aggregated metrics
 */
function calculateAggregateMetrics(data, type) {
  if (!Array.isArray(data) || data.length === 0) {
    return type === 'partB' 
      ? { implantations: 0, payment: 0, avgReimbursement: '0' }
      : { claims: 0, spending: 0, avgCostPerClaim: '0' };
  }
  
  if (type === 'partB') {
    const implantations = data.reduce((sum, item) => sum + (item.implantations || 0), 0);
    const payment = data.reduce((sum, item) => sum + (item.totalPayment || 0), 0);
    
    return {
      implantations,
      payment,
      avgReimbursement: implantations > 0 ? (payment / implantations).toFixed(2) : '0'
    };
  } else {
    const claims = data.reduce((sum, item) => sum + (item.totalClaims || 0), 0);
    const spending = data.reduce((sum, item) => sum + (item.totalSpending || 0), 0);
    
    return {
      claims,
      spending,
      avgCostPerClaim: claims > 0 ? (spending / claims).toFixed(2) : '0'
    };
  }
}


app.get('/api/analytics/implantations', async (req, res) => {
  const deviceCompetitors = competitors.filter(c => c.type === 'device');
  const cmsData = [];
  
  try {
    for (const comp of deviceCompetitors) {
      logger.info(`Processing implantation data for ${comp.name}`);
      
      for (const code of comp.cptCodes || []) {
        for (const year of [2020, 2021, 2022]) {
          try {
            const data = await fetchCmsPartBData(code, year);
            
            if (Array.isArray(data) && data.length > 0) {
              // Transform each record to include the competitor name and ensure fields exist
              const processedData = data.map(d => ({
                competitor: comp.name, // Ensure competitor name is assigned
                year: d.year || year,
                implantations: d.implantations || 0,
                avgPayment: d.avgPayment || 0,
                totalPayment: d.totalPayment || 0,
                providerCount: d.providerCount || 0,
                hcpcsCode: d.hcpcsCode || code
              }));
              
              cmsData.push(...processedData);
              logger.info(`Added ${processedData.length} records for ${comp.name}, code ${code}, year ${year}`);
            } else {
              logger.warn(`No data found for ${comp.name}, code ${code}, year ${year}`);
            }
          } catch (error) {
            logger.error(`Error fetching CMS data for ${code}-${year}: ${error.message}`);
          }
        }
      }
    }
    
    // Log total records collected
    logger.info(`Total CMS records collected: ${cmsData.length}`);
    
    // Calculate total implantations per competitor for debugging
    const implantationTotals = {};
    cmsData.forEach(entry => {
      if (entry.competitor && entry.implantations) {
        implantationTotals[entry.competitor] = (implantationTotals[entry.competitor] || 0) + entry.implantations;
      }
    });
    logger.info(`Implantation totals by competitor: ${JSON.stringify(implantationTotals)}`);
    
    const trends = analyzeImplantationTrends(cmsData);
    res.json(trends);
  } catch (error) {
    logger.error(`Error generating implantation analytics: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/reimbursements', async (req, res) => {
  const deviceCompetitors = competitors.filter(c => c.type === 'device');
  const cmsData = [];
  
  try {
    for (const comp of deviceCompetitors) {
      logger.info(`Processing reimbursement data for ${comp.name}`);
      
      for (const code of comp.cptCodes || []) {
        for (const year of [2020, 2021, 2022]) {
          try {
            const data = await fetchCmsPartBData(code, year);
            
            if (Array.isArray(data) && data.length > 0) {
              // Transform each record to include the competitor name
              const processedData = data.map(d => ({
                competitor: comp.name,
                year: d.year || year,
                implantations: d.implantations || 0,
                avgPayment: d.avgPayment || 0,
                totalPayment: d.totalPayment || 0,
                providerCount: d.providerCount || 0,
                hcpcsCode: d.hcpcsCode || code
              }));
              
              cmsData.push(...processedData);
              logger.info(`Added ${processedData.length} records for ${comp.name}, code ${code}, year ${year}`);
            } else {
              logger.warn(`No data found for ${comp.name}, code ${code}, year ${year}`);
            }
          } catch (error) {
            logger.error(`Error fetching CMS data for ${code}-${year}: ${error.message}`);
          }
        }
      }
    }
    
    // Log total records collected
    logger.info(`Total CMS records collected: ${cmsData.length}`);
    
    // Calculate average reimbursement per competitor for debugging
    const reimbursementAverages = {};
    const totals = {};
    
    cmsData.forEach(entry => {
      if (entry.competitor && entry.avgPayment !== undefined && entry.implantations !== undefined) {
        if (!totals[entry.competitor]) {
          totals[entry.competitor] = { totalPayment: 0, totalServices: 0 };
        }
        totals[entry.competitor].totalPayment += entry.avgPayment * entry.implantations;
        totals[entry.competitor].totalServices += entry.implantations;
      }
    });
    
    Object.keys(totals).forEach(competitor => {
      const { totalPayment, totalServices } = totals[competitor];
      reimbursementAverages[competitor] = totalServices > 0 ? 
        Math.round((totalPayment / totalServices) * 100) / 100 : 0;
    });
    
    logger.info(`Average reimbursements by competitor: ${JSON.stringify(reimbursementAverages)}`);
    
    const trends = analyzeReimbursementTrends(cmsData);
    res.json(trends);
  } catch (error) {
    logger.error(`Error generating reimbursement analytics: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Updated market share endpoint
app.get('/api/analytics/marketshare', async (req, res) => {
  const deviceCompetitors = competitors.filter(c => c.type === 'device');
  const cmsData = [];
  
  try {
    for (const comp of deviceCompetitors) {
      logger.info(`Processing market data for ${comp.name}`);
      
      for (const code of comp.cptCodes || []) {
        for (const year of [2020, 2021, 2022]) {
          try {
            const data = await fetchCmsPartBData(code, year);
            
            if (Array.isArray(data) && data.length > 0) {
              // Transform each record to include the competitor name
              const processedData = data.map(d => ({
                competitor: comp.name,
                year: d.year || year,
                implantations: d.implantations || 0,
                avgPayment: d.avgPayment || 0,
                totalPayment: d.totalPayment || 0,
                providerCount: d.providerCount || 0,
                hcpcsCode: d.hcpcsCode || code
              }));
              
              cmsData.push(...processedData);
            } else {
              logger.warn(`No data found for ${comp.name}, code ${code}, year ${year}`);
            }
          } catch (error) {
            logger.error(`Error fetching CMS data for ${code}-${year}: ${error.message}`);
          }
        }
      }
    }
    
    // Allow a custom refractory population size via query parameter
    const refractoryPopulation = req.query.refractory ? 
      parseInt(req.query.refractory) : 1000000;
    
    const share = estimateMarketShare(cmsData, refractoryPopulation);
    
    // Add some helpful context to the response
    share.context = {
      disclaimer: "Market share estimates are based on Medicare claims data only and may not represent the entire market",
      competitors: deviceCompetitors.map(c => ({
        name: c.name,
        treatment: c.treatment,
        cptCodes: c.cptCodes
      })),
      dataPoints: cmsData.length
    };
    
    res.json(share);
  } catch (error) {
    logger.error(`Error generating market share analytics: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/data', async (req, res) => {
  const { company } = req.query;
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i); // 2025, 2024, 2023, 2022, 2021
  
  try {
    logger.info(`Fetching market data for ${company || 'all competitors'} across years: ${years.join(', ')}`);

    // Filter target competitor(s)
    const targetCompetitors = company 
      ? competitors.filter(c => c.name.toLowerCase() === company.toLowerCase() || 
                             (c.company && c.company.toLowerCase() === company.toLowerCase()))
      : competitors;

    if (targetCompetitors.length === 0) {
      logger.warn(`No competitors found for ${company}`);
      return res.status(404).json({ error: `Company ${company} not found` });
    }

    const cptCodes = [...new Set(targetCompetitors
      .filter(c => c.type === 'device' && c.cptCodes)
      .flatMap(c => c.cptCodes))];
    const drugNames = [...new Set(targetCompetitors
      .filter(c => c.type === 'drug')
      .map(c => c.name))];

    if (cptCodes.length === 0 && drugNames.length === 0) {
      logger.warn('No CPT codes or drug names found for selected competitors');
      return res.status(400).json({ error: 'No CPT codes or drug names available for market data' });
    }

    // Initialize response structure
    const marketData = {
      cptCodes: cptCodes.length > 0 ? cptCodes : null,
      drugNames: drugNames.length > 0 ? drugNames : null,
      partB: cptCodes.length > 0 ? {
        totalImplantations: 0,
        totalPayment: 0,
        avgReimbursement: 0,
        yearlyTrends: {},
        yoyGrowth: { implantations: 'N/A', payment: 'N/A' },
        marketShare: '0%',
        cagr: 'N/A'
      } : null,
      partD: drugNames.length > 0 ? {
        totalSpending: 0,
        totalClaims: 0,
        avgCostPerClaim: 0,
        yearlyTrends: {},
        yoyGrowth: { spending: 'N/A', claims: 'N/A' },
        marketShare: '0%',
        cagr: 'N/A'
      } : null,
      companyComparisons: {}
    };

    // Helper function to calculate CAGR
    const calculateCAGR = (startValue, endValue, periods) => {
      if (startValue <= 0 || endValue <= 0 || periods <= 0) return 'N/A';
      const cagr = (Math.pow(endValue / startValue, 1 / periods) - 1) * 100;
      return cagr.toFixed(2) + '%';
    };

    // Fetch Part B data (Devices)
    if (cptCodes.length > 0) {
      // Initialize yearly trends
      for (const year of years) {
        marketData.partB.yearlyTrends[year] = { 
          implantations: 0, 
          payment: 0, 
          avgReimbursement: 0, 
          growth: { implantations: 'N/A', payment: 'N/A' } 
        };
      }

      // Process each CPT code
      for (const code of cptCodes) {
        for (const year of years) {
          const data = await fetchCmsPartBData(code, year);
          logger.debug(`Part B data for ${code}, ${year}: ${JSON.stringify(data?.slice(0, 1))}`);
          
          if (Array.isArray(data) && data.length > 0) {
            // Sum up data across all records for this code and year
            const yearImplantations = data.reduce((sum, item) => sum + (item.implantations || 0), 0);
            const yearPayment = data.reduce((sum, item) => sum + (item.totalPayment || 0), 0);
            
            // Skip if data looks suspicious
            if (yearImplantations > 0 && yearImplantations < 100000000) {
              marketData.partB.yearlyTrends[year].implantations += yearImplantations;
              marketData.partB.yearlyTrends[year].payment += yearPayment;
              marketData.partB.totalImplantations += yearImplantations;
              marketData.partB.totalPayment += yearPayment;
            } else if (yearImplantations > 0) {
              logger.warn(`Potentially unrealistic implantation count for CPT ${code}, year ${year}: ${yearImplantations}`);
            }
          } else {
            logger.warn(`No data found for CPT ${code}, year ${year}`);
          }
        }
      }

      // Calculate average reimbursement for each year
      for (const year of years) {
        marketData.partB.yearlyTrends[year].avgReimbursement = 
          marketData.partB.yearlyTrends[year].implantations > 0 
            ? (marketData.partB.yearlyTrends[year].payment / marketData.partB.yearlyTrends[year].implantations).toFixed(2) 
            : '0';
      }

      // Calculate overall average reimbursement
      marketData.partB.avgReimbursement = marketData.partB.totalImplantations > 0 
        ? (marketData.partB.totalPayment / marketData.partB.totalImplantations).toFixed(2) 
        : '0';

      // Calculate growth rates between years
      const partBTrendYears = Object.keys(marketData.partB.yearlyTrends).sort((a, b) => b - a); // Sort descending
      for (let i = 0; i < partBTrendYears.length - 1; i++) {
        const currentYear = partBTrendYears[i];
        const prevYear = partBTrendYears[i + 1];
        const currentImplantations = marketData.partB.yearlyTrends[currentYear].implantations;
        const prevImplantations = marketData.partB.yearlyTrends[prevYear].implantations;
        const currentPayment = marketData.partB.yearlyTrends[currentYear].payment;
        const prevPayment = marketData.partB.yearlyTrends[prevYear].payment;

        if (prevImplantations > 0) {
          const implantationsGrowth = ((currentImplantations - prevImplantations) / prevImplantations) * 100;
          marketData.partB.yearlyTrends[currentYear].growth.implantations = `${implantationsGrowth.toFixed(2)}%`;
        }

        if (prevPayment > 0) {
          const paymentGrowth = ((currentPayment - prevPayment) / prevPayment) * 100;
          marketData.partB.yearlyTrends[currentYear].growth.payment = `${paymentGrowth.toFixed(2)}%`;
        }

        // Set most recent YoY growth
        if (i === 0) {
          marketData.partB.yoyGrowth.implantations = marketData.partB.yearlyTrends[currentYear].growth.implantations;
          marketData.partB.yoyGrowth.payment = marketData.partB.yearlyTrends[currentYear].growth.payment;
        }
      }

      // Detect suspicious data patterns
      const allYearsIdentical = partBTrendYears.length > 1 && partBTrendYears.every((year, i, arr) => 
        i === 0 || 
        marketData.partB.yearlyTrends[year].implantations === marketData.partB.yearlyTrends[arr[0]].implantations
      );
      
      if (allYearsIdentical && marketData.partB.yearlyTrends[partBTrendYears[0]].implantations > 0) {
        logger.warn('Suspicious data pattern detected: identical implantation counts across all years');
      }

      // Calculate CAGR (oldest to newest)
      const oldestYear = partBTrendYears[partBTrendYears.length - 1];
      const newestYear = partBTrendYears[0];
      const yearSpan = parseInt(newestYear) - parseInt(oldestYear);
      
      if (yearSpan > 0) {
        marketData.partB.cagr = calculateCAGR(
          marketData.partB.yearlyTrends[oldestYear].implantations,
          marketData.partB.yearlyTrends[newestYear].implantations,
          yearSpan
        );
      }

      // Calculate market share
      try {
        // Get total market data for the most recent year
        const latestYear = years[0];
        let totalMarketImplantations = 0;
        
        // Get all CPT codes from all device competitors
        const allCptCodes = [...new Set(competitors
          .filter(c => c.type === 'device' && c.cptCodes)
          .flatMap(c => c.cptCodes))];
        
        // Fetch data for market share calculation
        for (const code of allCptCodes) {
          const data = await fetchCmsPartBData(code, latestYear);
          if (Array.isArray(data) && data.length > 0) {
            totalMarketImplantations += data.reduce((sum, item) => sum + (item.implantations || 0), 0);
          }
        }
        
        if (totalMarketImplantations > 0) {
          const targetImplantations = marketData.partB.yearlyTrends[latestYear]?.implantations || 0;
          marketData.partB.marketShare = `${((targetImplantations / totalMarketImplantations) * 100).toFixed(2)}%`;
        }
      } catch (marketShareError) {
        logger.error(`Error calculating market share: ${marketShareError.message}`);
        marketData.partB.marketShare = 'N/A';
      }
    }

    // Fetch Part D data (Drugs)
    if (drugNames.length > 0) {
      // Initialize yearly trends
      for (const year of years) {
        marketData.partD.yearlyTrends[year] = { 
          spending: 0, 
          claims: 0, 
          avgCostPerClaim: 0, 
          growth: { spending: 'N/A', claims: 'N/A' } 
        };
      }

      // Process each drug
      for (const drug of drugNames) {
        for (const year of years) {
          const data = await fetchCmsPartDData(drug, year);
          logger.debug(`Part D data for ${drug}, ${year}: ${JSON.stringify(data?.slice(0, 1))}`);
          
          if (Array.isArray(data) && data.length > 0) {
            // Sum up data across all records for this drug and year
            const yearSpending = data.reduce((sum, item) => sum + (item.totalSpending || 0), 0);
            const yearClaims = data.reduce((sum, item) => sum + (item.totalClaims || 0), 0);
            
            // Skip if data looks suspicious
            if (yearSpending > 0 && yearSpending < 10000000000) {
              marketData.partD.yearlyTrends[year].spending += yearSpending;
              marketData.partD.yearlyTrends[year].claims += yearClaims;
              marketData.partD.totalSpending += yearSpending;
              marketData.partD.totalClaims += yearClaims;
            } else if (yearSpending > 0) {
              logger.warn(`Potentially unrealistic spending for drug ${drug}, year ${year}: $${yearSpending}`);
            }
          } else {
            logger.warn(`No data found for drug ${drug}, year ${year}`);
          }
        }
      }

      // Calculate average cost per claim for each year
      for (const year of years) {
        marketData.partD.yearlyTrends[year].avgCostPerClaim = 
          marketData.partD.yearlyTrends[year].claims > 0 
            ? (marketData.partD.yearlyTrends[year].spending / marketData.partD.yearlyTrends[year].claims).toFixed(2) 
            : '0';
      }

      // Calculate overall average cost per claim
      marketData.partD.avgCostPerClaim = marketData.partD.totalClaims > 0 
        ? (marketData.partD.totalSpending / marketData.partD.totalClaims).toFixed(2) 
        : '0';

      // Calculate growth rates between years
      const partDTrendYears = Object.keys(marketData.partD.yearlyTrends).sort((a, b) => b - a); // Sort descending
      for (let i = 0; i < partDTrendYears.length - 1; i++) {
        const currentYear = partDTrendYears[i];
        const prevYear = partDTrendYears[i + 1];
        const currentSpending = marketData.partD.yearlyTrends[currentYear].spending;
        const prevSpending = marketData.partD.yearlyTrends[prevYear].spending;
        const currentClaims = marketData.partD.yearlyTrends[currentYear].claims;
        const prevClaims = marketData.partD.yearlyTrends[prevYear].claims;

        if (prevSpending > 0) {
          const spendingGrowth = ((currentSpending - prevSpending) / prevSpending) * 100;
          marketData.partD.yearlyTrends[currentYear].growth.spending = `${spendingGrowth.toFixed(2)}%`;
        }

        if (prevClaims > 0) {
          const claimsGrowth = ((currentClaims - prevClaims) / prevClaims) * 100;
          marketData.partD.yearlyTrends[currentYear].growth.claims = `${claimsGrowth.toFixed(2)}%`;
        }

        // Set most recent YoY growth
        if (i === 0) {
          marketData.partD.yoyGrowth.spending = marketData.partD.yearlyTrends[currentYear].growth.spending;
          marketData.partD.yoyGrowth.claims = marketData.partD.yearlyTrends[currentYear].growth.claims;
        }
      }

      // Calculate CAGR (oldest to newest)
      const oldestYear = partDTrendYears[partDTrendYears.length - 1];
      const newestYear = partDTrendYears[0];
      const yearSpan = parseInt(newestYear) - parseInt(oldestYear);
      
      if (yearSpan > 0) {
        marketData.partD.cagr = calculateCAGR(
          marketData.partD.yearlyTrends[oldestYear].spending,
          marketData.partD.yearlyTrends[newestYear].spending,
          yearSpan
        );
      }

      // Calculate market share
      try {
        // Get total market data for the most recent year
        const latestYear = years[0];
        let totalMarketSpending = 0;
        
        // Get all drug names from all drug competitors
        const allDrugNames = [...new Set(competitors
          .filter(c => c.type === 'drug')
          .map(c => c.name))];
        
        // Fetch data for market share calculation
        for (const drugName of allDrugNames) {
          const data = await fetchCmsPartDData(drugName, latestYear);
          if (Array.isArray(data) && data.length > 0) {
            totalMarketSpending += data.reduce((sum, item) => sum + (item.totalSpending || 0), 0);
          }
        }
        
        if (totalMarketSpending > 0) {
          const targetSpending = marketData.partD.yearlyTrends[latestYear]?.spending || 0;
          marketData.partD.marketShare = `${((targetSpending / totalMarketSpending) * 100).toFixed(2)}%`;
        }
      } catch (marketShareError) {
        logger.error(`Error calculating market share: ${marketShareError.message}`);
        marketData.partD.marketShare = 'N/A';
      }
    }

    // Company Comparisons (fetch data for top competitors)
    const comparisonCompanies = competitors
      .filter(c => c.name !== company && (c.type === 'device' || c.type === 'drug'))
      .slice(0, 4); // Limit to 4 comparisons for simplicity

    for (const comp of comparisonCompanies) {
      marketData.companyComparisons[comp.name] = {};
      
      if (comp.type === 'device' && comp.cptCodes) {
        const partBComp = { totalImplantations: 0, totalPayment: 0 };
        
        for (const year of years) {
          for (const code of comp.cptCodes) {
            const data = await fetchCmsPartBData(code, year);
            if (Array.isArray(data) && data.length > 0) {
              partBComp.totalImplantations += data.reduce((sum, item) => sum + (item.implantations || 0), 0);
              partBComp.totalPayment += data.reduce((sum, item) => sum + (item.totalPayment || 0), 0);
            }
          }
        }
        
        marketData.companyComparisons[comp.name].partB = partBComp;
      } else if (comp.type === 'drug') {
        const partDComp = { totalSpending: 0, totalClaims: 0 };
        
        for (const year of years) {
          const data = await fetchCmsPartDData(comp.name, year);
          if (Array.isArray(data) && data.length > 0) {
            partDComp.totalSpending += data.reduce((sum, item) => sum + (item.totalSpending || 0), 0);
            partDComp.totalClaims += data.reduce((sum, item) => sum + (item.totalClaims || 0), 0);
          }
        }
        
        marketData.companyComparisons[comp.name].partD = partDComp;
      }
    }

    logger.info(`Successfully fetched market data: Part B - ${marketData.partB?.totalImplantations || 0} implantations, Part D - $${marketData.partD?.totalSpending || 0} spending`);
    res.json({
      success: true,
      company: company || 'All Competitors',
      data: marketData
    });
  } catch (error) {
    logger.error(`Error fetching market data: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API endpoint for retrieving market data for a specific company
 */
app.get('/api/market/company/:companyName', async (req, res) => {
  const { companyName } = req.params;
  const { years: yearsParam, includeSimulated = 'true' } = req.query;
  
  try {
    logger.info(`Fetching market data for company: ${companyName}`);
    
    // Parse requested years or use defaults
    let requestedYears;
    if (yearsParam) {
      requestedYears = yearsParam.split(',').map(y => parseInt(y.trim()));
    } else {
      // Default: Last 3 confirmed years plus potential and simulated years
      requestedYears = [
        ...YEAR_CONFIG.confirmedDataYears.slice(-3),
        ...YEAR_CONFIG.potentialDataYears,
        ...(includeSimulated === 'true' ? YEAR_CONFIG.simulationYears : [])
      ].sort((a, b) => a - b);
    }
    
    // Find the company
    const company = competitors.find(c => c.name.toLowerCase() === companyName.toLowerCase());
    
    if (!company) {
      logger.warn(`Company not found: ${companyName}`);
      return res.status(404).json({ 
        success: false, 
        error: `Company not found: ${companyName}`,
        availableCompanies: competitors.map(c => c.name)
      });
    }
    
    // Initialize response structure
    const marketData = {
      companyInfo: {
        name: company.name,
        type: company.type,
        treatment: company.treatment,
        shortName: company.shortName || null,
        cik: company.cik || null,
        keywords: company.keywords || []
      },
      cptCodes: company.type === 'device' && company.cptCodes ? company.cptCodes : null,
      drugNames: company.type === 'drug' ? [company.name] : null,
      partB: company.type === 'device' && company.cptCodes ? {
        totalImplantations: 0,
        totalPayment: 0,
        avgReimbursement: '0',
        yearlyTrends: {},
        yoyGrowth: { implantations: 'N/A', payment: 'N/A' },
        marketShare: '0%',
        cagr: 'N/A',
        dataQuality: {
          simulatedYears: [],
          realDataYears: [],
          warnings: []
        }
      } : null,
      partD: company.type === 'drug' ? {
        totalSpending: 0,
        totalClaims: 0,
        avgCostPerClaim: '0',
        yearlyTrends: {},
        yoyGrowth: { spending: 'N/A', claims: 'N/A' },
        marketShare: '0%',
        cagr: 'N/A',
        dataQuality: {
          simulatedYears: [],
          realDataYears: [],
          warnings: []
        }
      } : null
    };
    
    // Fetch data based on company type
    if (company.type === 'device' && company.cptCodes) {
      // Initialize yearly trends
      for (const year of requestedYears) {
        marketData.partB.yearlyTrends[year] = {
          implantations: 0,
          payment: 0,
          avgReimbursement: '0',
          growth: { implantations: 'N/A', payment: 'N/A' },
          dataSource: 'pending'
        };
      }
      
      // Process each CPT code
      for (const code of company.cptCodes) {
        for (const year of requestedYears) {
          const { data, metadata } = await getYearData('partB', code, year);
          
          // Skip if no data
          if (!data || data.length === 0) {
            logger.warn(`No data available for CPT ${code}, year ${year}`);
            continue;
          }
          
          // Track data quality
          if (metadata.dataSourceType === 'simulated') {
            if (!marketData.partB.dataQuality.simulatedYears.includes(year)) {
              marketData.partB.dataQuality.simulatedYears.push(year);
            }
          } else if (metadata.dataSourceType === 'confirmed' || metadata.dataSourceType === 'potential') {
            if (!marketData.partB.dataQuality.realDataYears.includes(year)) {
              marketData.partB.dataQuality.realDataYears.push(year);
            }
          }
          
          // Add any warnings
          if (metadata.warnings && metadata.warnings.length > 0) {
            metadata.warnings.forEach(warning => {
              if (!marketData.partB.dataQuality.warnings.includes(warning)) {
                marketData.partB.dataQuality.warnings.push(warning);
              }
            });
          }
          
          // Aggregate data for this code and year
          const metrics = calculateAggregateMetrics(data, 'partB');
          
          // Update yearly trend
          marketData.partB.yearlyTrends[year].implantations += metrics.implantations;
          marketData.partB.yearlyTrends[year].payment += metrics.payment;
          marketData.partB.yearlyTrends[year].dataSource = metadata.dataSourceType;
          
          // Update totals
          marketData.partB.totalImplantations += metrics.implantations;
          marketData.partB.totalPayment += metrics.payment;
        }
      }
      
      // Calculate average reimbursement for each year
      for (const year of requestedYears) {
        marketData.partB.yearlyTrends[year].avgReimbursement = 
          marketData.partB.yearlyTrends[year].implantations > 0 
          ? (marketData.partB.yearlyTrends[year].payment / marketData.partB.yearlyTrends[year].implantations).toFixed(2)
          : '0';
      }
      
      // Calculate overall average reimbursement
      marketData.partB.avgReimbursement = marketData.partB.totalImplantations > 0
        ? (marketData.partB.totalPayment / marketData.partB.totalImplantations).toFixed(2)
        : '0';
      
      // Calculate growth rates between years
      const sortedYears = Object.keys(marketData.partB.yearlyTrends)
        .map(y => parseInt(y))
        .sort((a, b) => a - b);
      
      for (let i = 1; i < sortedYears.length; i++) {
        const currentYear = sortedYears[i];
        const prevYear = sortedYears[i - 1];
        const currentImplantations = marketData.partB.yearlyTrends[currentYear].implantations;
        const prevImplantations = marketData.partB.yearlyTrends[prevYear].implantations;
        const currentPayment = marketData.partB.yearlyTrends[currentYear].payment;
        const prevPayment = marketData.partB.yearlyTrends[prevYear].payment;
        
        if (prevImplantations > 0) {
          const implantationsGrowth = ((currentImplantations - prevImplantations) / prevImplantations) * 100;
          marketData.partB.yearlyTrends[currentYear].growth.implantations = `${implantationsGrowth.toFixed(2)}%`;
        }
        
        if (prevPayment > 0) {
          const paymentGrowth = ((currentPayment - prevPayment) / prevPayment) * 100;
          marketData.partB.yearlyTrends[currentYear].growth.payment = `${paymentGrowth.toFixed(2)}%`;
        }
        
        // Set most recent YoY growth (using real data if available)
        if (i === sortedYears.length - 1 || !marketData.partB.dataQuality.simulatedYears.includes(currentYear)) {
          marketData.partB.yoyGrowth.implantations = marketData.partB.yearlyTrends[currentYear].growth.implantations;
          marketData.partB.yoyGrowth.payment = marketData.partB.yearlyTrends[currentYear].growth.payment;
        }
      }
      
      // Calculate CAGR (using only real data)
      const realDataYears = sortedYears.filter(y => !marketData.partB.dataQuality.simulatedYears.includes(y));
      
      if (realDataYears.length >= 2) {
        const oldestYear = realDataYears[0];
        const newestYear = realDataYears[realDataYears.length - 1];
        const yearSpan = newestYear - oldestYear;
        
        if (yearSpan > 0 && marketData.partB.yearlyTrends[oldestYear].implantations > 0) {
          const startValue = marketData.partB.yearlyTrends[oldestYear].implantations;
          const endValue = marketData.partB.yearlyTrends[newestYear].implantations;
          const cagr = (Math.pow(endValue / startValue, 1 / yearSpan) - 1) * 100;
          marketData.partB.cagr = `${cagr.toFixed(2)}%`;
        }
      }
      
      // Calculate market share (latest available year)
      try {
        // Use the most recent year with real data
        const latestRealYear = Math.max(...marketData.partB.dataQuality.realDataYears);
        let totalMarketImplantations = 0;
        
        // Get all CPT codes from device competitors
        const allCptCodes = [...new Set(competitors
          .filter(c => c.type === 'device' && c.cptCodes)
          .flatMap(c => c.cptCodes))];
        
        // Get market data for this year
        for (const code of allCptCodes) {
          const { data } = await getYearData('partB', code, latestRealYear);
          
          if (Array.isArray(data) && data.length > 0) {
            const metrics = calculateAggregateMetrics(data, 'partB');
            totalMarketImplantations += metrics.implantations;
          }
        }
        
        if (totalMarketImplantations > 0) {
          const companyImplantations = marketData.partB.yearlyTrends[latestRealYear].implantations;
          marketData.partB.marketShare = `${((companyImplantations / totalMarketImplantations) * 100).toFixed(2)}%`;
        }
      } catch (marketShareError) {
        logger.error(`Error calculating market share: ${marketShareError.message}`);
        marketData.partB.marketShare = 'N/A';
        marketData.partB.dataQuality.warnings.push(`Market share calculation failed: ${marketShareError.message}`);
      }
    } else if (company.type === 'drug') {
      // Similar implementation for drug companies - Part D data
      const drugName = company.name;
      
      // Initialize yearly trends
      for (const year of requestedYears) {
        marketData.partD.yearlyTrends[year] = {
          spending: 0,
          claims: 0,
          avgCostPerClaim: '0',
          growth: { spending: 'N/A', claims: 'N/A' },
          dataSource: 'pending'
        };
      }
      
      // Fetch data for each year
      for (const year of requestedYears) {
        const { data, metadata } = await getYearData('partD', drugName, year);
        
        // Skip if no data
        if (!data || data.length === 0) {
          logger.warn(`No data available for drug ${drugName}, year ${year}`);
          continue;
        }
        
        // Track data quality
        if (metadata.dataSourceType === 'simulated') {
          if (!marketData.partD.dataQuality.simulatedYears.includes(year)) {
            marketData.partD.dataQuality.simulatedYears.push(year);
          }
        } else if (metadata.dataSourceType === 'confirmed' || metadata.dataSourceType === 'potential') {
          if (!marketData.partD.dataQuality.realDataYears.includes(year)) {
            marketData.partD.dataQuality.realDataYears.push(year);
          }
        }
        
        // Add any warnings
        if (metadata.warnings && metadata.warnings.length > 0) {
          metadata.warnings.forEach(warning => {
            if (!marketData.partD.dataQuality.warnings.includes(warning)) {
              marketData.partD.dataQuality.warnings.push(warning);
            }
          });
        }
        
        // Aggregate data for this year
        const metrics = calculateAggregateMetrics(data, 'partD');
        
        // Update yearly trend
        marketData.partD.yearlyTrends[year].spending = metrics.spending;
        marketData.partD.yearlyTrends[year].claims = metrics.claims;
        marketData.partD.yearlyTrends[year].avgCostPerClaim = metrics.avgCostPerClaim;
        marketData.partD.yearlyTrends[year].dataSource = metadata.dataSourceType;
        
        // Update totals
        marketData.partD.totalSpending += metrics.spending;
        marketData.partD.totalClaims += metrics.claims;
      }
      
      // Calculate average cost per claim
      marketData.partD.avgCostPerClaim = marketData.partD.totalClaims > 0
        ? (marketData.partD.totalSpending / marketData.partD.totalClaims).toFixed(2)
        : '0';
      
      // Calculate growth rates, CAGR, and market share - same pattern as partB
      // ... (similar implementation as above for Part B)
    }
    
    logger.info(`Successfully fetched market data for ${companyName}`);
    res.json({
      success: true,
      company: companyName,
      data: marketData
    });
  } catch (error) {
    logger.error(`Error fetching market data for ${companyName}: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});


app.get('/api/studies/:nctId', async (req, res) => {
    try {
      const { nctId } = req.params;
      const { fields } = req.query;
      
      console.log(`🔍 Fetching study details for: ${nctId}`);
      
      // Build parameters
      const params = new URLSearchParams();
      params.append('format', 'json');
      
      // Add specific fields if requested
      if (fields) {
        if (Array.isArray(fields)) {
          params.append('fields', fields.join(','));
        } else {
          params.append('fields', fields);
        }
      }
      
      const response = await axios.get(`https://clinicaltrials.gov/api/v2/studies/${nctId}`, {
        params: params
      });
      // fs.writeFile(
      //   `xxclinical_trial_${nctId}.json`,
      //   JSON.stringify(response.data, null, 2),
      //   (err) => {  // Callback function is required here
      //     if (err) {
      //       console.error('Error saving file:', err);
      //     } else {
      //       console.log(`Data successfully saved to clinical_trial_${nctId}.json`);
      //     }
      //   }
      // );
      // console.log(`Data successfully saved to clinical_trial_${nctId}.json`);
      // console.log(response.data.protocolSection.designModule.enrollmentInfo.count)
      res.json({
        success: true,
        data: response.data
      });
    } catch (error) {
    //   handleApiError(error, res);
    }
  });

/**
 * API endpoint for comparing multiple companies
 */
app.get('/api/market/comparison', async (req, res) => {
  const { companies: companiesParam, years: yearsParam, includeSimulated = 'true' } = req.query;
  
  try {
    // Parse companies parameter
    if (!companiesParam) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing companies parameter. Format: companies=Company1,Company2',
        availableCompanies: competitors.map(c => c.name)
      });
    }
    
    const companyNames = companiesParam.split(',').map(c => c.trim());
    logger.info(`Fetching market comparison data for companies: ${companyNames.join(', ')}`);
    
    // Parse requested years or use defaults
    let requestedYears;
    if (yearsParam) {
      requestedYears = yearsParam.split(',').map(y => parseInt(y.trim()));
    } else {
      // Default: Last 3 confirmed years plus potential and simulated years
      requestedYears = [
        ...YEAR_CONFIG.confirmedDataYears.slice(-3),
        ...YEAR_CONFIG.potentialDataYears,
        ...(includeSimulated === 'true' ? YEAR_CONFIG.simulationYears : [])
      ].sort((a, b) => a - b);
    }
    
    // Find requested companies
    const companies = companyNames.map(name => {
      const company = competitors.find(c => c.name.toLowerCase() === name.toLowerCase());
      
      if (!company) {
        logger.warn(`Company not found: ${name}`);
      }
      
      return company;
    }).filter(Boolean);
    
    if (companies.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No valid companies found',
        availableCompanies: competitors.map(c => c.name)
      });
    }
    
    // Initialize comparison response
    const comparisonData = {
      years: requestedYears,
      companies: {},
      marketTotals: {
        partB: {
          yearlyTrends: {},
          dataQuality: {
            simulatedYears: [],
            realDataYears: [],
            warnings: []
          }
        },
        partD: {
          yearlyTrends: {},
          dataQuality: {
            simulatedYears: [],
            realDataYears: [],
            warnings: []
          }
        }
      }
    };
    
    // Initialize market total yearly trends
    for (const year of requestedYears) {
      comparisonData.marketTotals.partB.yearlyTrends[year] = {
        implantations: 0,
        payment: 0,
        avgReimbursement: '0',
        dataSource: 'pending'
      };
      
      comparisonData.marketTotals.partD.yearlyTrends[year] = {
        spending: 0,
        claims: 0,
        avgCostPerClaim: '0',
        dataSource: 'pending'
      };
    }
    
    // Process each company
    for (const company of companies) {
      // Initialize company data structure
      comparisonData.companies[company.name] = {
        info: {
          name: company.name,
          type: company.type,
          treatment: company.treatment,
          shortName: company.shortName || null
        },
        partB: company.type === 'device' ? {
          cptCodes: company.cptCodes,
          yearlyTrends: {},
          marketShare: {},
          cagr: 'N/A',
          dataQuality: {
            simulatedYears: [],
            realDataYears: [],
            warnings: []
          }
        } : null,
        partD: company.type === 'drug' ? {
          yearlyTrends: {},
          marketShare: {},
          cagr: 'N/A',
          dataQuality: {
            simulatedYears: [],
            realDataYears: [],
            warnings: []
          }
        } : null
      };
      
      // Fetch data based on company type
      if (company.type === 'device' && company.cptCodes) {
        // Initialize yearly trends
        for (const year of requestedYears) {
          comparisonData.companies[company.name].partB.yearlyTrends[year] = {
            implantations: 0,
            payment: 0,
            avgReimbursement: '0',
            growth: { implantations: 'N/A', payment: 'N/A' },
            dataSource: 'pending'
          };
        }
        
        // Process each CPT code
        for (const code of company.cptCodes) {
          for (const year of requestedYears) {
            const { data, metadata } = await getYearData('partB', code, year);
            
            // Skip if no data
            if (!data || data.length === 0) {
              continue;
            }
            
            // Track data quality
            if (metadata.dataSourceType === 'simulated') {
              if (!comparisonData.companies[company.name].partB.dataQuality.simulatedYears.includes(year)) {
                comparisonData.companies[company.name].partB.dataQuality.simulatedYears.push(year);
              }
              
              if (!comparisonData.marketTotals.partB.dataQuality.simulatedYears.includes(year)) {
                comparisonData.marketTotals.partB.dataQuality.simulatedYears.push(year);
              }
            } else if (metadata.dataSourceType === 'confirmed' || metadata.dataSourceType === 'potential') {
              if (!comparisonData.companies[company.name].partB.dataQuality.realDataYears.includes(year)) {
                comparisonData.companies[company.name].partB.dataQuality.realDataYears.push(year);
              }
              
              if (!comparisonData.marketTotals.partB.dataQuality.realDataYears.includes(year)) {
                comparisonData.marketTotals.partB.dataQuality.realDataYears.push(year);
              }
            }
            
            // Aggregate data
            const metrics = calculateAggregateMetrics(data, 'partB');
            
            // Update company yearly trend
            comparisonData.companies[company.name].partB.yearlyTrends[year].implantations += metrics.implantations;
            comparisonData.companies[company.name].partB.yearlyTrends[year].payment += metrics.payment;
            comparisonData.companies[company.name].partB.yearlyTrends[year].dataSource = metadata.dataSourceType;
            
            // Update market totals
            comparisonData.marketTotals.partB.yearlyTrends[year].implantations += metrics.implantations;
            comparisonData.marketTotals.partB.yearlyTrends[year].payment += metrics.payment;
            comparisonData.marketTotals.partB.yearlyTrends[year].dataSource = 
              metadata.dataSourceType === 'confirmed' ? metadata.dataSourceType : 
              comparisonData.marketTotals.partB.yearlyTrends[year].dataSource;
          }
        }
        
        // Calculate average reimbursement for each year
        for (const year of requestedYears) {
          comparisonData.companies[company.name].partB.yearlyTrends[year].avgReimbursement = 
            comparisonData.companies[company.name].partB.yearlyTrends[year].implantations > 0 
            ? (comparisonData.companies[company.name].partB.yearlyTrends[year].payment / 
               comparisonData.companies[company.name].partB.yearlyTrends[year].implantations).toFixed(2)
            : '0';
          
          // Calculate market share for this year
          const marketTotal = comparisonData.marketTotals.partB.yearlyTrends[year].implantations;
          const companyTotal = comparisonData.companies[company.name].partB.yearlyTrends[year].implantations;
          
          if (marketTotal > 0) {
            comparisonData.companies[company.name].partB.marketShare[year] = 
              `${((companyTotal / marketTotal) * 100).toFixed(2)}%`;
          } else {
            comparisonData.companies[company.name].partB.marketShare[year] = 'N/A';
          }
        }
        
        // Calculate growth rates
        const sortedYears = requestedYears.sort((a, b) => a - b);
        
        for (let i = 1; i < sortedYears.length; i++) {
          const currentYear = sortedYears[i];
          const prevYear = sortedYears[i - 1];
          const current = comparisonData.companies[company.name].partB.yearlyTrends[currentYear];
          const prev = comparisonData.companies[company.name].partB.yearlyTrends[prevYear];
          
          if (prev.implantations > 0) {
            const implantationsGrowth = ((current.implantations - prev.implantations) / prev.implantations) * 100;
            current.growth.implantations = `${implantationsGrowth.toFixed(2)}%`;
          }
          
          if (prev.payment > 0) {
            const paymentGrowth = ((current.payment - prev.payment) / prev.payment) * 100;
            current.growth.payment = `${paymentGrowth.toFixed(2)}%`;
          }
        }
        
        // Calculate CAGR (using only real data)
        const realDataYears = sortedYears.filter(y => 
          !comparisonData.companies[company.name].partB.dataQuality.simulatedYears.includes(y));
        
        if (realDataYears.length >= 2) {
          const oldestYear = realDataYears[0];
          const newestYear = realDataYears[realDataYears.length - 1];
          const trends = comparisonData.companies[company.name].partB.yearlyTrends;
          
          if (trends[oldestYear].implantations > 0) {
            const yearSpan = newestYear - oldestYear;
            const startValue = trends[oldestYear].implantations;
            const endValue = trends[newestYear].implantations;
            const cagr = (Math.pow(endValue / startValue, 1 / yearSpan) - 1) * 100;
            comparisonData.companies[company.name].partB.cagr = `${cagr.toFixed(2)}%`;
          }
        }
      } else if (company.type === 'drug') {
        // Similar implementation for drug companies
        // ... (abbreviated for space)
      }
    }
    
    // Calculate market totals average reimbursement for each year
    for (const year of requestedYears) {
        const marketYear = comparisonData.marketTotals.partB.yearlyTrends[year];
        marketYear.avgReimbursement = marketYear.implantations > 0 
          ? (marketYear.payment / marketYear.implantations).toFixed(2) 
          : '0';
        
        // Part D totals
        const marketYearD = comparisonData.marketTotals.partD.yearlyTrends[year];
        marketYearD.avgCostPerClaim = marketYearD.claims > 0 
          ? (marketYearD.spending / marketYearD.claims).toFixed(2) 
          : '0';
      }
      
      // Add visualization data for charts
      comparisonData.visualizations = {
        marketShareTrend: {
          labels: requestedYears.map(y => y.toString()),
          datasets: companies.map(company => {
            // Determine if this is a device or drug company
            const marketShareType = company.type === 'device' ? 'partB' : 'partD';
            const companyData = comparisonData.companies[company.name][marketShareType];
            
            if (!companyData) return null;
            
            return {
              label: company.name,
              data: requestedYears.map(year => {
                const shareText = companyData.marketShare[year] || '0%';
                return parseFloat(shareText.replace('%', ''));
              }),
              simulatedYears: comparisonData.companies[company.name][marketShareType].dataQuality.simulatedYears
            };
          }).filter(Boolean)
        },
        yearlyGrowth: {
          labels: requestedYears.slice(1).map(y => y.toString()), // Skip first year (no growth data)
          datasets: companies.map(company => {
            // Determine if this is a device or drug company
            const marketDataType = company.type === 'device' ? 'partB' : 'partD';
            const metricType = company.type === 'device' ? 'implantations' : 'spending';
            const companyData = comparisonData.companies[company.name][marketDataType];
            
            if (!companyData) return null;
            
            return {
              label: company.name,
              data: requestedYears.slice(1).map(year => {
                const growthText = companyData.yearlyTrends[year].growth[metricType] || '0%';
                return parseFloat(growthText.replace('%', ''));
              }),
              simulatedYears: comparisonData.companies[company.name][marketDataType].dataQuality.simulatedYears
            };
          }).filter(Boolean)
        }
      };
      
      logger.info(`Successfully fetched market comparison data for ${companies.length} companies`);
      res.json({
        success: true,
        companies: companies.map(c => c.name),
        years: requestedYears,
        data: comparisonData
      });
    } catch (error) {
      logger.error(`Error fetching market comparison data: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
  
  /**
   * Test endpoint to verify data sources for a specific CPT code
   * Useful for debugging year-specific queries
   */
  app.get('/api/market/test-data-sources/:type/:code', async (req, res) => {
    const { type, code } = req.params;
    const { years: yearsParam } = req.query;
    
    try {
      // Validate type
      if (type !== 'partB' && type !== 'partD') {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid type. Must be partB or partD' 
        });
      }
      
      // Parse requested years or use defaults
      let requestedYears;
      if (yearsParam) {
        requestedYears = yearsParam.split(',').map(y => parseInt(y.trim()));
      } else {
        // Use all possible years for testing
        requestedYears = [
          ...YEAR_CONFIG.confirmedDataYears,
          ...YEAR_CONFIG.potentialDataYears,
          ...YEAR_CONFIG.simulationYears
        ].sort((a, b) => a - b);
      }
      
      logger.info(`Testing data sources for ${type}, code ${code}, years: ${requestedYears.join(', ')}`);
      
      // Fetch data for each year
      const results = {};
      
      for (const year of requestedYears) {
        const result = type === 'partB' 
          ? await fetchCmsPartBData(code, year) 
          : await fetchCmsPartDData(code, year);
        
        // Extract key metadata for display
        results[year] = {
          dataSourceType: result.metadata.dataSourceType,
          recordCount: result.data.length,
          totalRecordsInAPI: result.metadata.totalRecords || 0,
          apiRequests: result.metadata.totalRequests || 0,
          successfulRequests: result.metadata.successfulRequests || 0,
          warnings: result.metadata.warnings || [],
          fieldMapping: result.metadata.fieldMapping || {},
          sampleRecord: result.data.length > 0 ? result.data[0] : null,
          metrics: type === 'partB' 
            ? calculateAggregateMetrics(result.data, 'partB')
            : calculateAggregateMetrics(result.data, 'partD')
        };
      }
      
      // Check if we have any real data
      const yearsWithRealData = Object.entries(results)
        .filter(([_, data]) => data.dataSourceType === 'confirmed' || data.dataSourceType === 'potential')
        .map(([year]) => parseInt(year));
      
      // If we have multiple years of real data, see if they're identical (suspicious)
      let hasDuplicateData = false;
      let duplicateWarning = null;
      
      if (yearsWithRealData.length > 1) {
        // Compare metrics across real data years
        const metricsToCompare = type === 'partB' ? 'implantations' : 'claims';
        const distinctValues = new Set(yearsWithRealData.map(year => 
          results[year].metrics[metricsToCompare]
        ));
        
        if (distinctValues.size === 1) {
          hasDuplicateData = true;
          duplicateWarning = `Warning: All ${yearsWithRealData.length} years with real data have identical ${metricsToCompare} counts of ${[...distinctValues][0]}. This suggests the API may be returning the same data for all years.`;
        }
      }
      
      res.json({
        success: true,
        type,
        code,
        years: requestedYears,
        yearsWithRealData,
        hasDuplicateData,
        duplicateWarning,
        results
      });
    } catch (error) {
      logger.error(`Error testing data sources: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
  
  /**
   * Helper endpoint to verify year availability for all CPT codes
   */
  app.get('/api/market/verify-year-availability', async (req, res) => {
    try {
      // Get all unique CPT codes
      const allCptCodes = [...new Set(competitors
        .filter(c => c.type === 'device' && c.cptCodes)
        .flatMap(c => c.cptCodes))];
      
      // Get all unique drug names
      const allDrugNames = [...new Set(competitors
        .filter(c => c.type === 'drug')
        .map(c => c.name))];
      
      // Years to check (confirmed and potential)
      const yearsToCheck = [
        ...YEAR_CONFIG.confirmedDataYears,
        ...YEAR_CONFIG.potentialDataYears
      ];
      
      logger.info(`Verifying year availability for ${allCptCodes.length} CPT codes and ${allDrugNames.length} drugs across ${yearsToCheck.length} years`);
      
      // Check a sample of each type to minimize API calls
      const results = {
        partB: {},
        partD: {}
      };
      
      // Check Part B (use first 3 CPT codes for sampling)
      const sampleCptCodes = allCptCodes.slice(0, 3);
      
      for (const code of sampleCptCodes) {
        results.partB[code] = {};
        
        for (const year of yearsToCheck) {
          const result = await fetchCmsPartBData(code, year);
          
          results.partB[code][year] = {
            dataAvailable: result.data.length > 0,
            recordCount: result.data.length,
            dataSourceType: result.metadata.dataSourceType,
            mainWarning: result.metadata.warnings && result.metadata.warnings.length > 0 
              ? result.metadata.warnings[0] 
              : null
          };
        }
      }
      
      // Check Part D (use first 2 drugs for sampling)
      const sampleDrugs = allDrugNames.slice(0, 2);
      
      for (const drug of sampleDrugs) {
        results.partD[drug] = {};
        
        for (const year of yearsToCheck) {
          const result = await fetchCmsPartDData(drug, year);
          
          results.partD[drug][year] = {
            dataAvailable: result.data.length > 0,
            recordCount: result.data.length,
            dataSourceType: result.metadata.dataSourceType,
            mainWarning: result.metadata.warnings && result.metadata.warnings.length > 0 
              ? result.metadata.warnings[0] 
              : null
          };
        }
      }
      
      // Analyze results to recommend year configuration
      const yearAnalysis = {
        partB: {},
        partD: {}
      };
      
      for (const year of yearsToCheck) {
        // Analyze Part B
        const partBAvailability = Object.values(results.partB).map(codeData => codeData[year].dataAvailable);
        const partBDataAvailable = partBAvailability.some(available => available);
        const partBAllAvailable = partBAvailability.every(available => available);
        
        yearAnalysis.partB[year] = {
          dataAvailable: partBDataAvailable,
          allCodesAvailable: partBAllAvailable,
          recommendedCategory: partBAllAvailable ? 'confirmed' : 
                              partBDataAvailable ? 'potential' : 
                              'simulation'
        };
        
        // Analyze Part D
        const partDAvailability = Object.values(results.partD).map(drugData => drugData[year].dataAvailable);
        const partDDataAvailable = partDAvailability.some(available => available);
        const partDAllAvailable = partDAvailability.every(available => available);
        
        yearAnalysis.partD[year] = {
          dataAvailable: partDDataAvailable,
          allDrugsAvailable: partDAllAvailable,
          recommendedCategory: partDAllAvailable ? 'confirmed' : 
                              partDDataAvailable ? 'potential' : 
                              'simulation'
        };
      }
      
      // Generate recommended year configuration
      const recommendedConfig = {
        confirmedDataYears: yearsToCheck.filter(year => 
          yearAnalysis.partB[year].recommendedCategory === 'confirmed' || 
          yearAnalysis.partD[year].recommendedCategory === 'confirmed'
        ),
        potentialDataYears: yearsToCheck.filter(year => 
          yearAnalysis.partB[year].recommendedCategory === 'potential' || 
          yearAnalysis.partD[year].recommendedCategory === 'potential'
        ),
        simulationYears: [
          ...YEAR_CONFIG.simulationYears,
          ...yearsToCheck.filter(year => 
            yearAnalysis.partB[year].recommendedCategory === 'simulation' && 
            yearAnalysis.partD[year].recommendedCategory === 'simulation'
          )
        ]
      };
      
      res.json({
        success: true,
        sampleCptCodes,
        sampleDrugs,
        yearsChecked: yearsToCheck,
        results,
        yearAnalysis,
        currentConfig: {
          confirmedDataYears: YEAR_CONFIG.confirmedDataYears,
          potentialDataYears: YEAR_CONFIG.potentialDataYears,
          simulationYears: YEAR_CONFIG.simulationYears
        },
        recommendedConfig
      });
    } catch (error) {
      logger.error(`Error verifying year availability: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

// app.get('/api/market/data', async (req, res) => {
//   const { company } = req.query;
//   const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 - i); // 2024, 2023, 2022, 2021, 2020

//   try {
//       logger.info(`Fetching market data for ${company || 'all competitors'} across years: ${years.join(', ')}`);

//       const targetCompetitors = company 
//           ? competitors.filter(c => c.name.toLowerCase() === company.toLowerCase() || 
//                                    (c.company && c.company.toLowerCase() === company.toLowerCase()))
//           : competitors;

//       if (targetCompetitors.length === 0) {
//           logger.warn(`No competitors found for ${company}`);
//           return res.status(404).json({ error: `Company ${company} not found` });
//       }

//       const cptCodes = [...new Set(targetCompetitors
//           .filter(c => c.type === 'device' && c.cptCodes)
//           .flatMap(c => c.cptCodes))];
//       const drugNames = [...new Set(targetCompetitors
//           .filter(c => c.type === 'drug')
//           .map(c => c.name))];

//       if (cptCodes.length === 0 && drugNames.length === 0) {
//           logger.warn('No CPT codes or drug names found for selected competitors');
//           return res.status(400).json({ error: 'No CPT codes or drug names available for market data' });
//       }

//       const marketData = {
//           cptCodes: cptCodes.length > 0 ? cptCodes : null,
//           drugNames: drugNames.length > 0 ? drugNames : null,
//           partB: cptCodes.length > 0 ? {
//               totalImplantations: 0,
//               totalPayment: 0,
//               yearlyTrends: {},
//               avgReimbursement: 0,
//               yoyGrowth: 'N/A'
//           } : null,
//           partD: drugNames.length > 0 ? {
//               totalSpending: 0,
//               totalClaims: 0,
//               yearlyTrends: {},
//               avgCostPerClaim: 0,
//               yoyGrowth: 'N/A'
//           } : null
//       };

//       // Fetch Part B data
//       if (cptCodes.length > 0) {
//           for (const year of years) {
//               marketData.partB.yearlyTrends[year] = { implantations: 0, payment: 0 };
//               for (const code of cptCodes) {
//                   const data = await fetchCmsPartBData(code, year);
//                   logger.debug(`Part B data for ${code}, ${year}: ${JSON.stringify(data?.slice(0, 1))}`);
//                   if (Array.isArray(data) && data.length > 0) {
//                       const yearImplantations = data.reduce((sum, item) => sum + (item.implantations || 0), 0);
//                       const yearPayment = data.reduce((sum, item) => sum + (item.totalPayment || 0), 0);
//                       marketData.partB.yearlyTrends[year].implantations += yearImplantations;
//                       marketData.partB.yearlyTrends[year].payment += yearPayment;
//                       marketData.partB.totalImplantations += yearImplantations;
//                       marketData.partB.totalPayment += yearPayment;
//                   }
//               }
//               marketData.partB.yearlyTrends[year].avgReimbursement = 
//                   marketData.partB.yearlyTrends[year].implantations > 0 
//                       ? (marketData.partB.yearlyTrends[year].payment / marketData.partB.yearlyTrends[year].implantations).toFixed(2) 
//                       : 0;
//           }

//           marketData.partB.avgReimbursement = marketData.partB.totalImplantations > 0 
//               ? (marketData.partB.totalPayment / marketData.partB.totalImplantations).toFixed(2) 
//               : 0;

//           const partBTrendYears = Object.keys(marketData.partB.yearlyTrends).sort();
//           if (partBTrendYears.length > 1) {
//               const latestYear = partBTrendYears[partBTrendYears.length - 1];
//               const previousYear = partBTrendYears[partBTrendYears.length - 2];
//               const latestImplantations = marketData.partB.yearlyTrends[latestYear].implantations;
//               const prevImplantations = marketData.partB.yearlyTrends[previousYear].implantations;
//               if (prevImplantations > 0) {
//                   marketData.partB.yoyGrowth = (((latestImplantations - prevImplantations) / prevImplantations) * 100).toFixed(2) + '%';
//               }
//           }
//       }

//       // Fetch Part D data
//       if (drugNames.length > 0) {
//           for (const year of years) {
//               marketData.partD.yearlyTrends[year] = { spending: 0, claims: 0 };
//               for (const drug of drugNames) {
//                   const data = await fetchCmsPartDData(drug, year);
//                   logger.debug(`Part D data for ${drug}, ${year}: ${JSON.stringify(data?.slice(0, 1))}`);
//                   if (Array.isArray(data) && data.length > 0) {
//                       const yearSpending = data.reduce((sum, item) => sum + (item.totalSpending || 0), 0);
//                       const yearClaims = data.reduce((sum, item) => sum + (item.totalClaims || 0), 0);
//                       marketData.partD.yearlyTrends[year].spending += yearSpending;
//                       marketData.partD.yearlyTrends[year].claims += yearClaims;
//                       marketData.partD.totalSpending += yearSpending;
//                       marketData.partD.totalClaims += yearClaims;
//                   }
//               }
//               marketData.partD.yearlyTrends[year].avgCostPerClaim = 
//                   marketData.partD.yearlyTrends[year].claims > 0 
//                       ? (marketData.partD.yearlyTrends[year].spending / marketData.partD.yearlyTrends[year].claims).toFixed(2) 
//                       : 0;
//           }

//           marketData.partD.avgCostPerClaim = marketData.partD.totalClaims > 0 
//               ? (marketData.partD.totalSpending / marketData.partD.totalClaims).toFixed(2) 
//               : 0;

//           const partDTrendYears = Object.keys(marketData.partD.yearlyTrends).sort();
//           if (partDTrendYears.length > 1) {
//               const latestYear = partDTrendYears[partDTrendYears.length - 1];
//               const previousYear = partDTrendYears[partDTrendYears.length - 2];
//               const latestSpending = marketData.partD.yearlyTrends[latestYear].spending;
//               const prevSpending = marketData.partD.yearlyTrends[previousYear].spending;
//               if (prevSpending > 0) {
//                   marketData.partD.yoyGrowth = (((latestSpending - prevSpending) / prevSpending) * 100).toFixed(2) + '%';
//               }
//           }
//       }

//       logger.info(`Successfully fetched market data: Part B - ${marketData.partB?.totalImplantations || 0} implantations, Part D - $${marketData.partD?.totalSpending || 0} spending`);
//       res.json({
//           success: true,
//           company: company || 'All Competitors',
//           data: marketData
//       });
//   } catch (error) {
//       logger.error(`Error fetching market data: ${error.message}`);
//       res.status(500).json({ error: error.message });
//   }
// });

// Add a comprehensive device market dashboard endpoint
app.get('/api/dashboard/devices', async (req, res) => {
  try {
    const deviceCompetitors = competitors.filter(c => c.type === 'device');
    
    // Get all data at once to avoid repeated API calls
    const cmsData = [];
    const competitorData = {};
    
    // Initialize data structure for each competitor
    deviceCompetitors.forEach(comp => {
      competitorData[comp.name] = {
        name: comp.name,
        treatment: comp.treatment,
        cptCodes: comp.cptCodes,
        shortName: comp.shortName,
        cik: comp.cik,
        implantations: {
          2020: 0,
          2021: 0,
          2022: 0,
          total: 0
        },
        reimbursement: {
          2020: 0,
          2021: 0, 
          2022: 0,
          average: 0
        },
        providers: {
          2020: 0,
          2021: 0,
          2022: 0,
          unique: 0
        },
        cptCodeBreakdown: {}
      };
    });
    
    // Collect all CMS data
    for (const comp of deviceCompetitors) {
      for (const code of comp.cptCodes || []) {
        // Initialize CPT code breakdown
        if (!competitorData[comp.name].cptCodeBreakdown[code]) {
          competitorData[comp.name].cptCodeBreakdown[code] = {
            total: 0,
            years: {}
          };
        }
        
        for (const year of [2020, 2021, 2022]) {
          try {
            const data = await fetchCmsPartBData(code, year);
            
            if (Array.isArray(data) && data.length > 0) {
              // Add data to the combined dataset
              const processedData = data.map(d => ({
                competitor: comp.name,
                year: d.year || year,
                implantations: d.implantations || 0,
                avgPayment: d.avgPayment || 0,
                totalPayment: d.totalPayment || 0,
                providerCount: d.providerCount || 0,
                hcpcsCode: d.hcpcsCode || code
              }));
              
              cmsData.push(...processedData);
              
              // Calculate totals for this CPT code and year
              const yearTotal = processedData.reduce((sum, d) => sum + d.implantations, 0);
              const yearPayment = processedData.reduce((sum, d) => sum + (d.avgPayment * d.implantations), 0);
              const yearProviders = processedData.reduce((sum, d) => sum + d.providerCount, 0);
              
              // Update competitor data structure
              competitorData[comp.name].implantations[year] += yearTotal;
              competitorData[comp.name].implantations.total += yearTotal;
              
              if (yearTotal > 0) {
                competitorData[comp.name].reimbursement[year] = 
                  (competitorData[comp.name].reimbursement[year] * 
                    (competitorData[comp.name].implantations[year] - yearTotal) + 
                    yearPayment) / competitorData[comp.name].implantations[year];
              }
              
              competitorData[comp.name].providers[year] += yearProviders;
              
              // Update CPT code breakdown
              if (!competitorData[comp.name].cptCodeBreakdown[code].years[year]) {
                competitorData[comp.name].cptCodeBreakdown[code].years[year] = 0;
              }
              competitorData[comp.name].cptCodeBreakdown[code].years[year] += yearTotal;
              competitorData[comp.name].cptCodeBreakdown[code].total += yearTotal;
            }
          } catch (error) {
            logger.error(`Error fetching CMS data for ${comp.name}, ${code}, ${year}: ${error.message}`);
          }
        }
      }
      
      // Calculate average reimbursement across all years
      const totalImplantations = competitorData[comp.name].implantations.total;
      if (totalImplantations > 0) {
        const weightedSum = 
          competitorData[comp.name].reimbursement[2020] * competitorData[comp.name].implantations[2020] +
          competitorData[comp.name].reimbursement[2021] * competitorData[comp.name].implantations[2021] +
          competitorData[comp.name].reimbursement[2022] * competitorData[comp.name].implantations[2022];
        
        competitorData[comp.name].reimbursement.average = weightedSum / totalImplantations;
      }
      
      // Round all reimbursement values for cleaner display
      Object.keys(competitorData[comp.name].reimbursement).forEach(key => {
        competitorData[comp.name].reimbursement[key] = 
          Math.round(competitorData[comp.name].reimbursement[key] * 100) / 100;
      });
      
      // Estimate unique providers (assuming 25% overlap between years)
      const uniqueProviders = Math.round(
        competitorData[comp.name].providers[2020] +
        competitorData[comp.name].providers[2021] * 0.75 +
        competitorData[comp.name].providers[2022] * 0.5
      );
      
      competitorData[comp.name].providers.unique = uniqueProviders;
    }
    
    // Calculate market trends
    const marketTrends = {
      implantations: {
        2020: 0,
        2021: 0,
        2022: 0,
        total: 0,
        cagr: 0
      },
      reimbursement: {
        2020: 0,
        2021: 0,
        2022: 0,
        average: 0
      },
      marketShares: {}
    };
    
    // Calculate totals across all competitors
    deviceCompetitors.forEach(comp => {
      const data = competitorData[comp.name];
      
      marketTrends.implantations[2020] += data.implantations[2020];
      marketTrends.implantations[2021] += data.implantations[2021];
      marketTrends.implantations[2022] += data.implantations[2022];
      marketTrends.implantations.total += data.implantations.total;
    });
    
    // Calculate CAGR (Compound Annual Growth Rate)
    if (marketTrends.implantations[2020] > 0 && marketTrends.implantations[2022] > 0) {
      const years = 2; // 2020 to 2022 is 2 years
      marketTrends.implantations.cagr = (
        Math.pow(marketTrends.implantations[2022] / marketTrends.implantations[2020], 1/years) - 1
      ) * 100;
    }
    
    // Calculate market shares for each year
    deviceCompetitors.forEach(comp => {
      const data = competitorData[comp.name];
      marketTrends.marketShares[comp.name] = {
        2020: marketTrends.implantations[2020] > 0 ? 
          (data.implantations[2020] / marketTrends.implantations[2020] * 100) : 0,
        2021: marketTrends.implantations[2021] > 0 ? 
          (data.implantations[2021] / marketTrends.implantations[2021] * 100) : 0,
        2022: marketTrends.implantations[2022] > 0 ? 
          (data.implantations[2022] / marketTrends.implantations[2022] * 100) : 0,
        total: marketTrends.implantations.total > 0 ? 
          (data.implantations.total / marketTrends.implantations.total * 100) : 0
      };
      
      // Round all market share values
      Object.keys(marketTrends.marketShares[comp.name]).forEach(key => {
        marketTrends.marketShares[comp.name][key] = 
          Math.round(marketTrends.marketShares[comp.name][key] * 100) / 100;
      });
    });
    
    // Calculate weighted average reimbursement
    if (marketTrends.implantations[2020] > 0) {
      let weightedSum = 0;
      deviceCompetitors.forEach(comp => {
        const data = competitorData[comp.name];
        weightedSum += data.reimbursement[2020] * data.implantations[2020];
      });
      marketTrends.reimbursement[2020] = weightedSum / marketTrends.implantations[2020];
    }
    
    if (marketTrends.implantations[2021] > 0) {
      let weightedSum = 0;
      deviceCompetitors.forEach(comp => {
        const data = competitorData[comp.name];
        weightedSum += data.reimbursement[2021] * data.implantations[2021];
      });
      marketTrends.reimbursement[2021] = weightedSum / marketTrends.implantations[2021];
    }
    
    if (marketTrends.implantations[2022] > 0) {
      let weightedSum = 0;
      deviceCompetitors.forEach(comp => {
        const data = competitorData[comp.name];
        weightedSum += data.reimbursement[2022] * data.implantations[2022];
      });
      marketTrends.reimbursement[2022] = weightedSum / marketTrends.implantations[2022];
    }
    
    if (marketTrends.implantations.total > 0) {
      let weightedSum = 0;
      deviceCompetitors.forEach(comp => {
        const data = competitorData[comp.name];
        weightedSum += data.reimbursement.average * data.implantations.total;
      });
      marketTrends.reimbursement.average = weightedSum / marketTrends.implantations.total;
    }

    // Round all reimbursement values in market trends
    Object.keys(marketTrends.reimbursement).forEach(key => {
      marketTrends.reimbursement[key] = 
        Math.round(marketTrends.reimbursement[key] * 100) / 100;
    });

    // Create chart data for the dashboard
    const chartData = {
      implantationTrends: {
        labels: [2020, 2021, 2022],
        datasets: deviceCompetitors.map(comp => ({
          label: `${comp.name}`,
          data: [
            competitorData[comp.name].implantations[2020],
            competitorData[comp.name].implantations[2021],
            competitorData[comp.name].implantations[2022]
          ]
        }))
      },
      reimbursementTrends: {
        labels: [2020, 2021, 2022],
        datasets: deviceCompetitors.map(comp => ({
          label: `${comp.name}`,
          data: [
            competitorData[comp.name].reimbursement[2020],
            competitorData[comp.name].reimbursement[2021],
            competitorData[comp.name].reimbursement[2022]
          ]
        }))
      },
      marketShareTrends: {
        labels: [2020, 2021, 2022],
        datasets: deviceCompetitors.map(comp => ({
          label: `${comp.name}`,
          data: [
            marketTrends.marketShares[comp.name][2020],
            marketTrends.marketShares[comp.name][2021],
            marketTrends.marketShares[comp.name][2022]
          ]
        }))
      },
      cptCodeUsage: {
        labels: [...new Set(deviceCompetitors.flatMap(c => c.cptCodes || []))],
        datasets: deviceCompetitors.map(comp => {
          const cptData = comp.cptCodes?.map(code => 
            competitorData[comp.name].cptCodeBreakdown[code]?.total || 0
          ) || [];
          
          return {
            label: comp.name,
            data: cptData
          };
        })
      }
    };

    // Return the comprehensive dashboard
    res.json({
      competitors: Object.values(competitorData),
      marketTrends,
      chartData,
      metadata: {
        description: "Comprehensive device market analytics based on Medicare claims data",
        disclaimer: "Data represents Medicare claims only and may not represent the entire market",
        dataPoints: cmsData.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error(`Error generating device dashboard: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to debug CMS data fields
function debugCmsFields(data) {
if (!Array.isArray(data) || data.length === 0) {
return 'No data or empty array';
}

const sample = data[0];
return {
availableFields: Object.keys(sample),
sampleValues: Object.entries(sample).map(([key, value]) => ({
  field: key,
  value: value,
  type: typeof value
}))
};
}

// Add a diagnostics endpoint to help debug CMS data issues
app.get('/api/diagnostics/cms', async (req, res) => {
try {
const { code, year } = req.query;

if (!code || !year) {
  return res.status(400).json({
    error: 'Missing parameters',
    message: 'Please provide both code and year query parameters'
  });
}

// Fetch data for the specified CPT code and year
const data = await fetchCmsPartBData(code, year);

// Check if we got data back
if (!Array.isArray(data) || data.length === 0) {
  // Try the fallback API directly
  try {
    const fallbackUrl = `https://data.cms.gov/resource/97y4-7qau.json?hcpcs_code=${code}&year=${year}&$limit=5`;
    logger.info(`Trying direct fallback CMS Part B endpoint for diagnostics: ${code}, ${year}`);
    
    const fallbackResponse = await axios.get(fallbackUrl);
    
    if (Array.isArray(fallbackResponse.data) && fallbackResponse.data.length > 0) {
      const fieldInfo = debugCmsFields(fallbackResponse.data);
      
      return res.json({
        source: 'Fallback API',
        recordCount: fallbackResponse.data.length,
        sampleRecord: fallbackResponse.data[0],
        fields: fieldInfo,
        apiUrl: fallbackUrl
      });
    } else {
      return res.json({
        error: 'No data found in either primary or fallback API',
        code,
        year
      });
    }
  } catch (fallbackError) {
    return res.status(500).json({
      error: 'Error in fallback API',
      message: fallbackError.message,
      code,
      year
    });
  }
}

// Debug the structure of the data
const fieldInfo = debugCmsFields(data);

// Return diagnostic information
res.json({
  source: 'Primary API',
  recordCount: data.length,
  mappedRecord: data[0], // After our mapping function
  sampleRecords: data.slice(0, 3),
  fields: fieldInfo,
  summary: {
    totalImplantations: data.reduce((sum, item) => sum + (item.implantations || 0), 0),
    avgPayment: data.reduce((sum, item) => sum + (item.avgPayment || 0), 0) / data.length,
    providerCount: data.reduce((sum, item) => sum + (item.providerCount || 0), 0)
  },
  code,
  year
});
} catch (error) {
res.status(500).json({
  error: 'Error in diagnostics endpoint',
  message: error.message
});
}
});

// Add a device market overview endpoint for quick insights
app.get('/api/overview/devices', async (req, res) => {
try {
// Get aggregate metrics for all device competitors
const deviceCompetitors = competitors.filter(c => c.type === 'device');

// Get high-level data for the latest year (2022)
const year = 2022;
const marketData = [];

// Prepare a response structure
const response = {
  competitors: deviceCompetitors.map(c => c.name),
  year,
  totalImplantations: 0,
  avgReimbursement: 0,
  competitorData: {},
  cptCodes: {}
};

// Initialize competitor data
deviceCompetitors.forEach(comp => {
  response.competitorData[comp.name] = {
    implantations: 0,
    reimbursement: 0,
    marketShare: 0
  };
});

// Get all unique CPT codes
const allCptCodes = [...new Set(deviceCompetitors.flatMap(c => c.cptCodes || []))];

// Initialize CPT code data
allCptCodes.forEach(code => {
  response.cptCodes[code] = {
    implantations: 0,
    reimbursement: 0,
    description: '',
    competitors: []
  };
});

// Collect data for each competitor and CPT code
for (const comp of deviceCompetitors) {
  let competitorTotal = 0;
  let competitorPayment = 0;
  
  for (const code of comp.cptCodes || []) {
    try {
      const data = await fetchCmsPartBData(code, year);
      
      if (Array.isArray(data) && data.length > 0) {
        // Calculate totals for this CPT code
        const codeTotal = data.reduce((sum, d) => sum + (d.implantations || 0), 0);
        const codePayment = data.reduce((sum, d) => sum + (d.avgPayment * d.implantations || 0), 0);
        
        // Update competitor total
        competitorTotal += codeTotal;
        competitorPayment += codePayment;
        
        // Update CPT code data
        response.cptCodes[code].implantations += codeTotal;
        response.cptCodes[code].reimbursement = codeTotal > 0 ? 
          Math.round(codePayment / codeTotal * 100) / 100 : 0;
          
        // Get CPT code description from first record if available
        if (data[0].hcpcsDescription) {
          response.cptCodes[code].description = data[0].hcpcsDescription;
        }
        
        // Add competitor to the CPT code's competitor list if not already there
        if (!response.cptCodes[code].competitors.includes(comp.name)) {
          response.cptCodes[code].competitors.push(comp.name);
        }
        
        // Add to market total
        response.totalImplantations += codeTotal;
      }
    } catch (error) {
      logger.error(`Error fetching data for ${comp.name}, ${code}, ${year}: ${error.message}`);
    }
  }
  
  // Update competitor data
  response.competitorData[comp.name].implantations = competitorTotal;
  response.competitorData[comp.name].reimbursement = competitorTotal > 0 ? 
    Math.round(competitorPayment / competitorTotal * 100) / 100 : 0;
}

// Calculate market shares
if (response.totalImplantations > 0) {
  deviceCompetitors.forEach(comp => {
    const implantations = response.competitorData[comp.name].implantations;
    response.competitorData[comp.name].marketShare = 
      Math.round(implantations / response.totalImplantations * 10000) / 100; // To 2 decimal places
  });
}

// Calculate overall average reimbursement
let totalPayment = 0;
deviceCompetitors.forEach(comp => {
  const data = response.competitorData[comp.name];
  totalPayment += data.implantations * data.reimbursement;
});

response.avgReimbursement = response.totalImplantations > 0 ? 
  Math.round(totalPayment / response.totalImplantations * 100) / 100 : 0;

// Return the overview
res.json(response);
} catch (error) {
logger.error(`Error generating device overview: ${error.message}`);
res.status(500).json({ error: error.message });
}
});


app.get('/api/analytics/trials', async (req, res) => {
  try {
    const allTrials = [];
    
    for (const comp of competitors) {
      const trials = await fetchClinicalTrials(comp.keywords[0]);
      trials.forEach(t => t.competitor = comp.name);
      allTrials.push(...trials);
    }
    
    const analysis = analyzeTrialActivity(allTrials);
    res.json(analysis);
  } catch (error) {
    logger.error(`Error generating trial analytics: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/drugspending', async (req, res) => {
  try {
    const drugCompetitors = competitors.filter(c => c.type === 'drug');
    const cmsData = [];
    
    for (const comp of drugCompetitors) {
      for (const year of [2020, 2021, 2022]) {
        const data = await fetchCmsPartDData(comp.treatment, year);
        data.forEach(d => d.competitor = comp.name);
        cmsData.push(...data);
      }
    }
    
    const trends = analyzeDrugSpending(cmsData);
    res.json(trends);
  } catch (error) {
    logger.error(`Error generating drug spending analytics: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint for FDA endpoints documentation
app.get('/api/reference/fda-endpoints', (req, res) => {
  const fdaEndpoints = {
    drug: {
      drugsFda: {
        description: "Drug product approvals and labeling",
        url: "https://api.fda.gov/drug/drugsfda.json",
        sampleSearch: "products.brand_name:\"DRUG_NAME\""
      },
      label: {
        description: "Drug product labeling",
        url: "https://api.fda.gov/drug/label.json",
        sampleSearch: "openfda.brand_name:\"DRUG_NAME\""
      },
      ndc: {
        description: "National Drug Code Directory",
        url: "https://api.fda.gov/drug/ndc.json",
        sampleSearch: "brand_name:\"DRUG_NAME\""
      },
      enforcement: {
        description: "Drug recalls and enforcement reports",
        url: "https://api.fda.gov/drug/enforcement.json",
        sampleSearch: "product_description:\"DRUG_NAME\""
      },
      event: {
        description: "Adverse events reported to FDA",
        url: "https://api.fda.gov/drug/event.json",
        sampleSearch: "patient.drug.openfda.brand_name:\"DRUG_NAME\""
      }
    },
    device: {
      device510k: {
        description: "Medical device clearances",
        url: "https://api.fda.gov/device/510k.json",
        sampleSearch: "device_name:\"DEVICE_NAME\""
      },
      classification: {
        description: "Medical device classifications",
        url: "https://api.fda.gov/device/classification.json",
        sampleSearch: "device_name:\"DEVICE_NAME\""
      },
      enforcement: {
        description: "Device recalls and enforcement reports",
        url: "https://api.fda.gov/device/enforcement.json",
        sampleSearch: "product_description:\"DEVICE_NAME\""
      },
      event: {
        description: "Device adverse events",
        url: "https://api.fda.gov/device/event.json",
        sampleSearch: "device.brand_name:\"DEVICE_NAME\""
      },
      pma: {
        description: "Premarket approvals",
        url: "https://api.fda.gov/device/pma.json",
        sampleSearch: "device_name:\"DEVICE_NAME\""
      },
      recall: {
        description: "Device recalls",
        url: "https://api.fda.gov/device/recall.json",
        sampleSearch: "product_description:\"DEVICE_NAME\""
      },
      registrationlisting: {
        description: "Registered device establishments",
        url: "https://api.fda.gov/device/registrationlisting.json",
        sampleSearch: "device_name:\"DEVICE_NAME\""
      }
    }
  };
  
  res.json(fdaEndpoints);
});

// Add detailed endpoint for Orange Book data
app.get('/api/orangebook/:drugName', async (req, res) => {
  try {
    const drugName = req.params.drugName;
    const orangeBookData = await fetchOrangeBookData(drugName);
    
    // Add context for easier interpretation
    const enhancedData = {
      ...orangeBookData,
      context: {
        exclusivityCodes: {
          "ODE": "Orphan Drug Exclusivity",
          "NCE": "New Chemical Entity Exclusivity",
          "NDF": "New Dosage Form Exclusivity",
          "PDX": "Pediatric Exclusivity",
          "D-180": "180-Day Generic Drug Exclusivity",
          "RX": "Prescription to OTC Switch Exclusivity",
          "RTO": "Reference Listed Drug (RLD) exclusivity"
        },
        teCodesMeaning: {
          "AA": "No bioequivalence problems",
          "AB": "Meets necessary bioequivalence requirements",
          "BC": "Controlled bioequivalence studies did not meet required standards",
          "BP": "Bio-problematic drug product",
          "B*": "Requires further FDA review"
        }
      }
    };
    
    res.json(enhancedData);
  } catch (error) {
    logger.error(`Error fetching Orange Book data for ${req.params.drugName}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});


// Add a new endpoint to get SEC data for a specific competitor
// Add a new direct SEC lookup endpoint with fallback to public APIs
app.get('/api/sec/:cik', async (req, res) => {
  const cik = req.params.cik;
  
  if (!cik) {
    return res.status(400).json({ error: 'CIK parameter is required' });
  }
  
  try {
    logger.info(`Processing SEC data request for CIK: ${cik}`);
    
    // Try to fetch from SEC API
    const secData = await fetchSecFilings(cik);
    
    // If no data found, try alternative sources
    if (secData.length === 0) {
      logger.info(`No SEC filings found for ${cik}, trying alternative sources`);
      
      // Try searching for the company data using the Financial Modeling Prep API (free tier)
      try {
        const fmpApiKey = process.env.FMP_API_KEY || 'demo'; // Get your API key from financialmodelingprep.com
        const fmpUrl = `https://financialmodelingprep.com/api/v3/sec_filings/${cik.replace(/^0+/, '')}?limit=10&apikey=${fmpApiKey}`;
        
        const fmpResponse = await axios.get(fmpUrl, { timeout: 10000 });
        
        if (fmpResponse.data && Array.isArray(fmpResponse.data) && fmpResponse.data.length > 0) {
          logger.info(`Found ${fmpResponse.data.length} filings from Financial Modeling Prep API`);
          
          const filings = fmpResponse.data.map(f => ({
            form: f.type || 'Unknown',
            description: getFormDescription(f.type || 'Unknown'),
            filingDate: f.fillingDate || f.filingDate || 'Unknown',
            reportDate: f.acceptanceDateTime || f.fillingDate || 'Unknown',
            accessionNumber: f.accessionNumber || 'Unknown',
            cik: cik,
            source: 'Financial Modeling Prep API',
            url: f.finalLink || `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`
          }));
          
          const competitor = competitors.find(c => c.cik === cik);
          const companyName = competitor ? competitor.name : null;
          
          res.json({
            cik,
            companyName,
            filingCount: filings.length,
            filings: filings,
            source: 'Financial Modeling Prep API',
            secUrl: `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`
          });
          
          return;
        }
      } catch (fmpError) {
        logger.error(`Financial Modeling Prep API error: ${fmpError.message}`);
      }
      
      // If we still don't have data, try one more source - Alpha Vantage
      try {
        const avApiKey = process.env.ALPHA_VANTAGE_API_KEY || 'demo'; // Get your API key from alphavantage.co
        const avUrl = `https://www.alphavantage.co/query?function=LISTING_STATUS&apikey=${avApiKey}`;
        
        const avResponse = await axios.get(avUrl, { timeout: 10000 });
        
        if (avResponse.data) {
          logger.info(`Got response from Alpha Vantage, checking for company`);
          
          // Alpha Vantage doesn't have a direct CIK lookup, but we can see if the company exists
          // For now, just return placeholder data
          const competitor = competitors.find(c => c.cik === cik);
          
          if (competitor) {
            // Return placeholder data with Alpha Vantage attribution
            const mockFilings = [{
              form: "Company Data",
              description: "Company found in Alpha Vantage database",
              filingDate: new Date().toISOString().split('T')[0],
              reportDate: "See SEC website for filings",
              accessionNumber: "AV-Listing",
              cik: cik,
              source: 'Alpha Vantage API',
              url: `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`
            }];
            
            res.json({
              cik,
              companyName: competitor.name,
              filingCount: mockFilings.length,
              filings: mockFilings,
              source: 'Alpha Vantage API',
              secUrl: `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`,
              note: "Limited data available - please check SEC website for complete filings"
            });
            
            return;
          }
        }
      } catch (avError) {
        logger.error(`Alpha Vantage API error: ${avError.message}`);
      }
      
      // If we've tried everything and still don't have data, create mock data
      const mockFiling = getMockSecFiling(cik);
      const competitor = competitors.find(c => c.cik === cik);
      const companyName = competitor ? competitor.name : mockFiling.entityName;
      
      res.json({
        cik,
        companyName,
        filingCount: 1,
        filings: [mockFiling],
        source: 'Placeholder Data',
        secUrl: `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`,
        note: "This is placeholder data. Please visit the SEC EDGAR website for actual filings."
      });
      
      return;
    }
    
    // If we got SEC data, return it normally
    const competitor = competitors.find(c => c.cik === cik);
    const companyName = competitor ? competitor.name : (secData[0]?.entityName || null);
    
    res.json({
      cik,
      companyName,
      filingCount: secData.length,
      filings: secData,
      source: 'SEC API',
      secUrl: `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`
    });
  } catch (error) {
    logger.error(`Error fetching SEC data for CIK ${cik}: ${error.message}`);
    
    // Still return something useful even if an error occurred
    const competitor = competitors.find(c => c.cik === cik);
    const mockFiling = getMockSecFiling(cik);
    
    res.status(200).json({ 
      cik,
      companyName: competitor?.name || mockFiling.entityName,
      error: 'Error fetching SEC data',
      errorMessage: error.message,
      filingCount: 1,
      filings: [mockFiling],
      source: 'Error Fallback',
      secUrl: `https://www.sec.gov/edgar/browse/?CIK=${cik.replace(/^0+/, '')}&owner=exclude`,
      note: "Error occurred fetching SEC data. This is placeholder data only."
    });
  }
});

// Add a direct company search endpoint for SEC data
app.get('/api/sec/company/:name', async (req, res) => {
  const companyName = req.params.name;
  
  if (!companyName) {
    return res.status(400).json({ error: 'Company name parameter is required' });
  }
  
  try {
    // Find competitor by name
    const competitor = competitors.find(c => 
      c.name.toLowerCase() === companyName.toLowerCase() || 
      (c.company && c.company.toLowerCase() === companyName.toLowerCase())
    );
    
    if (competitor && competitor.cik) {
      // Redirect to the CIK endpoint
      return res.redirect(`/api/sec/${competitor.cik}`);
    }
    
    // If not found in our competitors list, try looking up the company
    logger.info(`Trying to find SEC data for company: ${companyName}`);
    
    // Try searching via Financial Modeling Prep API
    try {
      const fmpApiKey = process.env.FMP_API_KEY || 'demo';
      const fmpUrl = `https://financialmodelingprep.com/api/v3/search?query=${encodeURIComponent(companyName)}&limit=5&apikey=${fmpApiKey}`;
      
      const fmpResponse = await axios.get(fmpUrl, { timeout: 10000 });
      
      if (fmpResponse.data && Array.isArray(fmpResponse.data) && fmpResponse.data.length > 0) {
        // Find the best match
        const bestMatch = fmpResponse.data[0];
        logger.info(`Found company match: ${bestMatch.name} (${bestMatch.symbol})`);
        
        // Get the CIK if available
        if (bestMatch.cik) {
          // Redirect to the CIK endpoint
          return res.redirect(`/api/sec/${bestMatch.cik}`);
        }
      }
    } catch (fmpError) {
      logger.error(`Financial Modeling Prep company search error: ${fmpError.message}`);
    }
    
    // If we couldn't find the company, return a helpful message
    res.json({
      companyName,
      found: false,
      message: `Could not find SEC data for company: ${companyName}`,
      suggestions: [
        "Check the company name spelling",
        "Try searching by ticker symbol",
        "Use the direct CIK if known",
        "Private companies won't have SEC filings"
      ]
    });
  } catch (error) {
    logger.error(`Error in company SEC search for ${companyName}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Add SEC dashboard endpoint that returns data for all public competitors
// Add a comprehensive SEC dashboard endpoint with financial data
app.get('/api/dashboard/sec', async (req, res) => {
  try {
    // Get all competitors with CIK values
    const publicCompanies = competitors.filter(c => c.cik);
    
    if (publicCompanies.length === 0) {
      return res.json({ 
        message: 'No public companies found with CIK values',
        companies: [] 
      });
    }
    
    // Prepare parallel promises to fetch all SEC data and financial metrics
    const companyData = await Promise.all(
      publicCompanies.map(async (company) => {
        try {
          // Step 1: Get basic filing information
          const filings = await fetchSecFilings(company.cik);
          
          // Extract entity information
          const entityInfo = filings.length > 0 && filings[0].entityInfo ? 
            filings[0].entityInfo : 
            { entityName: company.name };
          
          // Step 2: Try to get financial data using the companyfacts API
          let financialData = {};
          
          try {
            const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik.padStart(10, '0')}.json`;
            
            const factsResponse = await axios.get(factsUrl, {
              headers: { 
                'User-Agent': 'EpilepsyMedtechCompetitorAnalysis (compliance@example.com)',
                'Accept': 'application/json'
              },
              timeout: 15000
            });
            
            if (factsResponse.data && factsResponse.data.facts) {
              // Successfully got financial data
              logger.info(`Retrieved financial data for ${company.name}`);
              
              // Extract key financial metrics if available
              financialData = extractFinancialMetrics(factsResponse.data.facts);
            }
          } catch (factsError) {
            logger.error(`Error fetching financial data for ${company.name}: ${factsError.message}`);
          }
          
          // Count filing types
          const filingTypes = {};
          filings.forEach(filing => {
            filingTypes[filing.form] = (filingTypes[filing.form] || 0) + 1;
          });
          
          // Find the latest 10-K and 10-Q
          const latest10K = filings.find(f => f.form === '10-K');
          const latest10Q = filings.find(f => f.form === '10-Q');
          
          return {
            name: company.name,
            type: company.type,
            treatment: company.treatment,
            cik: company.cik,
            entityName: entityInfo.entityName,
            sicDescription: entityInfo.sicDescription,
            exchanges: entityInfo.exchanges || [],
            tickers: entityInfo.tickers || [],
            filings: {
              count: filings.length,
              latest: filings.length > 0 ? filings[0] : null,
              latest10K,
              latest10Q,
              byType: filingTypes,
              recentFilings: filings.slice(0, 5) // Include 5 most recent filings
            },
            financials: financialData,
            secUrl: `https://www.sec.gov/edgar/browse/?CIK=${company.cik.replace(/^0+/, '')}&owner=exclude`
          };
        } catch (error) {
          logger.error(`Error processing SEC data for ${company.name}: ${error.message}`);
          
          return {
            name: company.name,
            type: company.type,
            treatment: company.treatment,
            cik: company.cik,
            error: error.message,
            filings: { count: 0 },
            secUrl: `https://www.sec.gov/edgar/browse/?CIK=${company.cik.replace(/^0+/, '')}&owner=exclude`
          };
        }
      })
    );
    
    // Calculate industry comparisons
    const byIndustry = {};
    companyData.forEach(company => {
      if (company.sicDescription) {
        if (!byIndustry[company.sicDescription]) {
          byIndustry[company.sicDescription] = [];
        }
        byIndustry[company.sicDescription].push(company.name);
      }
    });
    
    // Calculate financial comparisons if data is available
    const financialComparisons = calculateFinancialComparisons(companyData);
    
    res.json({
      companies: companyData,
      summaries: {
        byIndustry,
        financialComparisons
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error in SEC dashboard: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to extract key financial metrics from XBRL facts
function extractFinancialMetrics(facts) {
  const metrics = {
    revenue: {},
    netIncome: {},
    assets: {},
    liabilities: {},
    equity: {},
    calculatedMetrics: {}
  };
  
  try {
    // GAAP/IFRS metrics we're interested in
    const revenueKeys = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'];
    const netIncomeKeys = ['NetIncomeLoss', 'ProfitLoss'];
    const assetsKeys = ['Assets', 'AssetsCurrent'];
    const liabilitiesKeys = ['Liabilities', 'LiabilitiesCurrent'];
    const equityKeys = ['StockholdersEquity', 'PartnersCapital', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'];
    
    // Extract revenue data
    for (const key of revenueKeys) {
      if (facts['us-gaap'] && facts['us-gaap'][key]) {
        const usdData = facts['us-gaap'][key].units.USD;
        if (usdData && usdData.length > 0) {
          // Sort by end date (latest first)
          const latestEntries = [...usdData].sort((a, b) => new Date(b.end) - new Date(a.end));
          
          // Get latest annual and quarterly
          const annual = latestEntries.find(e => {
            const startDate = new Date(e.start);
            const endDate = new Date(e.end);
            // Roughly a year apart (within 30 days)
            return Math.abs((endDate - startDate) / (1000 * 60 * 60 * 24 * 365) - 1) < 0.1;
          });
          
          const quarterly = latestEntries.find(e => {
            const startDate = new Date(e.start);
            const endDate = new Date(e.end);
            // Roughly a quarter apart (within 15 days)
            return Math.abs((endDate - startDate) / (1000 * 60 * 60 * 24 * 91) - 1) < 0.15;
          });
          
          if (annual) {
            metrics.revenue.annual = {
              value: annual.val,
              period: `${annual.start} to ${annual.end}`,
              filed: annual.filed
            };
          }
          
          if (quarterly) {
            metrics.revenue.quarterly = {
              value: quarterly.val,
              period: `${quarterly.start} to ${quarterly.end}`,
              filed: quarterly.filed
            };
          }
          
          break; // Found revenue data, stop searching
        }
      }
    }
    
    // Similar process for other metrics
    // Net Income
    for (const key of netIncomeKeys) {
      if (facts['us-gaap'] && facts['us-gaap'][key]) {
        const usdData = facts['us-gaap'][key].units.USD;
        if (usdData && usdData.length > 0) {
          const latestEntries = [...usdData].sort((a, b) => new Date(b.end) - new Date(a.end));
          
          const annual = latestEntries.find(e => {
            const startDate = new Date(e.start);
            const endDate = new Date(e.end);
            return Math.abs((endDate - startDate) / (1000 * 60 * 60 * 24 * 365) - 1) < 0.1;
          });
          
          if (annual) {
            metrics.netIncome.annual = {
              value: annual.val,
              period: `${annual.start} to ${annual.end}`,
              filed: annual.filed
            };
          }
          
          break;
        }
      }
    }
    
    // Assets
    for (const key of assetsKeys) {
      if (facts['us-gaap'] && facts['us-gaap'][key]) {
        const usdData = facts['us-gaap'][key].units.USD;
        if (usdData && usdData.length > 0) {
          const latestEntries = [...usdData].sort((a, b) => new Date(b.end) - new Date(a.end));
          
          if (latestEntries.length > 0) {
            metrics.assets.latest = {
              value: latestEntries[0].val,
              date: latestEntries[0].end,
              filed: latestEntries[0].filed
            };
          }
          
          break;
        }
      }
    }
    
    // Calculate metrics if we have the data
    if (metrics.revenue.annual && metrics.netIncome.annual) {
      metrics.calculatedMetrics.profitMargin = {
        value: (metrics.netIncome.annual.value / metrics.revenue.annual.value) * 100,
        formula: 'Net Income / Revenue * 100'
      };
    }
    
    return metrics;
  } catch (error) {
    logger.error(`Error extracting financial metrics: ${error.message}`);
    return { error: error.message };
  }
}

// Helper function to calculate financial comparisons
function calculateFinancialComparisons(companyData) {
  const comparisons = {
    revenue: [],
    profitMargin: [],
    timestamp: new Date().toISOString()
  };
  
  try {
    // Revenue comparison
    companyData.forEach(company => {
      if (company.financials && 
          company.financials.revenue && 
          company.financials.revenue.annual) {
        
        comparisons.revenue.push({
          company: company.name,
          value: company.financials.revenue.annual.value,
          period: company.financials.revenue.annual.period
        });
      }
    });
    
    // Sort by revenue (highest first)
    comparisons.revenue.sort((a, b) => b.value - a.value);
    
    // Profit margin comparison
    companyData.forEach(company => {
      if (company.financials && 
          company.financials.calculatedMetrics && 
          company.financials.calculatedMetrics.profitMargin) {
        
        comparisons.profitMargin.push({
          company: company.name,
          value: company.financials.calculatedMetrics.profitMargin.value,
          formula: company.financials.calculatedMetrics.profitMargin.formula
        });
      }
    });
    
    // Sort by profit margin (highest first)
    comparisons.profitMargin.sort((a, b) => b.value - a.value);
    
    return comparisons;
  } catch (error) {
    logger.error(`Error calculating financial comparisons: ${error.message}`);
    return { error: error.message };
  }
}

// Add a comparative analysis endpoint to get SEC data for multiple competitors

// Update the SEC comparison API route to use the improved functions
app.get('/api/analytics/sec-comparison', async (req, res) => {
  try {
    // Get all competitors with CIK values
    const publicCompanies = competitors.filter(c => c.cik);
    
    if (publicCompanies.length === 0) {
      return res.json({ 
        message: 'No public companies found with CIK values',
        companies: [] 
      });
    }
    
    // Fetch SEC data for all public companies
    const secData = {};
    
    for (const company of publicCompanies) {
      try {
        const filings = await fetchSecFilings(company.cik);
        
        // Extract entity information from the first filing if available
        const entityInfo = filings.length > 0 && filings[0].entityInfo ? 
          filings[0].entityInfo : 
          { entityName: company.name };
        
        // Count filing types
        const filingTypes = {};
        filings.forEach(filing => {
          filingTypes[filing.form] = (filingTypes[filing.form] || 0) + 1;
        });
        
        // Find the latest 10-K and 10-Q
        const latest10K = filings.find(f => f.form === '10-K');
        const latest10Q = filings.find(f => f.form === '10-Q');
        
        secData[company.name] = {
          cik: company.cik,
          entityName: entityInfo.entityName,
          filingCount: filings.length,
          latestFiling: filings.length > 0 ? filings[0] : null,
          latest10K,
          latest10Q,
          filingTypes,
          exchanges: entityInfo.exchanges || [],
          tickers: entityInfo.tickers || [],
          sicDescription: entityInfo.sicDescription,
          secUrl: `https://www.sec.gov/edgar/browse/?CIK=${company.cik.replace(/^0+/, '')}&owner=exclude`
        };
      } catch (error) {
        logger.error(`Error fetching SEC data for ${company.name}: ${error.message}`);
        secData[company.name] = {
          cik: company.cik,
          error: error.message,
          filingCount: 0,
          latestFiling: null,
          filingTypes: {},
          secUrl: `https://www.sec.gov/edgar/browse/?CIK=${company.cik.replace(/^0+/, '')}&owner=exclude`
        };
      }
    }
    
    res.json({
      companies: publicCompanies.map(c => c.name),
      secData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error in SEC comparison: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to count filing types
function countFilingTypes(filings) {
  const counts = {};
  
  filings.forEach(filing => {
    counts[filing.form] = (counts[filing.form] || 0) + 1;
  });
  
  return counts;
}

// Add a health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Add Middleware for error handling
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({
    error: 'Server error',
    message: err.message
  });
});

// Add middleware to handle 404 routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.url} not found`
  });
});

// Initialize the data directory if it doesn't exist
async function initializeDataDirectory() {
  const dataDir = 'data';
  
  try {
    await fs.access(dataDir);
    logger.info('Data directory exists');
  } catch (err) {
    logger.info('Creating data directory');
    await fs.mkdir(dataDir, { recursive: true });
  }
  
  // Check for Orange Book data files and create them if they don't exist
  const orangeBookFiles = {
    'products_data.json': [],
    'patent_data.json': [],
    'exclusivity_data.json': []
  };
  
  for (const [filename, defaultData] of Object.entries(orangeBookFiles)) {
    const filePath = path.join(dataDir, filename);
    
    try {
      await fs.access(filePath);
      logger.info(`File exists: ${filename}`);
    } catch (err) {
      logger.info(`Creating file: ${filename}`);
      await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
    }
  }
}

// Start Server
(async () => {
  try {
    await initializeDataDirectory();
    
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Health check available at: http://localhost:${PORT}/health`);
      logger.info(`Competitors list available at: http://localhost:${PORT}/api/competitors`);
    });
  } catch (error) {
    logger.error(`Error starting server: ${error.message}`);
    process.exit(1);
  }
})();
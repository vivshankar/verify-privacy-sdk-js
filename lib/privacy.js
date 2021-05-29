const ConfigurationError = require('./errors/configurationError')
const DPCMService = require('./services/dpcm/dpcmService')
const StringUtils = require('./utils/stringUtils')
const debug = require('debug')('verify:privacy')

/**
 * Class representing the Privacy SDK for IBM Security Verify. Used to 
 * perform privacy assessment for attributes being requested and metadata required to build consent
 * experiences.
 * 
 * @module Privacy
 * @author Vivek Shankar
 */
class Privacy {

    /**
     * Create a new {@link Privacy} object.
     * 
     * @param {Object} config
     * @param {string} config.tenantUrl The Verify tenant hostname, including the protocol.
     * @param {Object} auth
     * @param {string} auth.accessToken The OAuth 2.0 token used to authorize requests
     * @param {Object} context
     * @param {string} context.subjectId The user/subject identifier that may be a
     * Verify user identifier.
     * @param {boolean} context.isExternalSubject Indicates if the subject is known
     * to Verify.
     * @param {string} context.ipAddress The IP address of the user agent. If this
     * library is used in a backend system, this IP should be obtained from the 
     * request headers that contain the actual user agent IP address.
     */
    constructor(config, auth, context = {}) {
        if (!StringUtils.has(config, 'tenantUrl')) {
            throw new ConfigurationError(
                `Cannot find property 'tenantUrl' in configuration settings.`);
        }

        if (!StringUtils.has(auth, 'accessToken')) {
            throw new ConfigurationError(
                `Cannot find property 'accessToken' in auth`);
        }

        this._config = config;
        this._auth = auth;
        this._context = context;
    }

    /**
     * The assessment object for a specific request item
     * @typedef {Object} module:Privacy~Assessment
     * @property {string} purposeId The purpose or EULA ID representing the privacy
     * purpose or EULA configured on Verify.
     * @property {string} accessTypeId The access type ID representing the 
     * available access types on Verify. This is one of the access types configured
     * for the purpose and optionally the attribute.
     * @property {string} attributeId The attribute ID on Verify. This is one of the 
     * attributes for the purpose.
     * @property {Object} result The result object that contains the decision.
     * @property {boolean} result.approved Indicates if the request has been approved
     * @property {Object} result.reason If "approved" is false, the details of the denial
     * @property {string} result.reason.messageId Verify error code
     * @property {string} result.reason.messageDescription Localized description of the error
     */

    /**
     * The assessment response object
     * @typedef {Object} module:Privacy~WrappedAssessment
     * @property {string} status The overall assessment status is computed based on the contents
     * of the assessment.
     * <br><code>approved</code> - all items are approved
     * <br><code>consent</code> - some or all items require consent
     * <br><code>denied</code> - approval is denied for all items
     * <br><code>error</code> - invalid request or system error
     * @property {module:Privacy~Assessment} assessment The assessment details
     * @property {Object} detail The error details if the status is "error"
     * @property {string} detail.messageId Verify error code
     * @property {string} detail.messageDescription Localized description of the error
     */

    /**
     * Evaluate the attributes requested for approval.
     *
     * Request the consent management system to approve the use of attributes
     * for the specified purpose, access type and an optional value. If the 
     * access type is not specified, it is set to a system default.
     * 
     * @param {Array} items The data items that require approval for use
     * @param {string} items.purposeId The purpose ID representing the privacy
     * purpose configured on Verify. If you are checking for the consent status
     * of EULA, use the EULA identifier here.
     * @param {string} items.accessTypeId The access type ID representing the 
     * available access types on Verify. This must be one of the access types
     * selected for the purpose.
     * @param {string} items.attributeId The attribute ID on Verify. This must be
     * configured as one of the attributes for the purpose. This may be optional if
     * no attributes are configured for the purpose.
     * @param {string} items.attributeValue The attribute value for the attribute.
     * This is typically used when the user has more than one value for the attribute.
     * This is optional.
     * 
     * @return {Promise<module:Privacy~WrappedAssessment>} The status of the assessment
     * and additional details
     */
    async assess(items) {

        const methodName = `${Privacy.name}:assess(items)`
        const service = new DPCMService(this._auth, this._config.tenantUrl, this._context)
        try {
            const assessment = await service.requestApproval(items);
            debug(`[${methodName}]`, 'assessment:',
                JSON.stringify(assessment));

            // process the response
            if (!Array.isArray(assessment)) {
                return {
                    status: "error",
                    data: {
                        "messageId": "INVALID_DATATYPE",
                        "messageDescription": `'assessment' is expected to be an array. Received ${typeof assessment}`
                    }
                };
            }

            let status = null;
            for (const ia of assessment) {

                if (ia.result && ia.result[0].approved) {
                    if (status == null) {
                        status = "approved";
                    }

                    continue;
                }

                if (ia.result && ia.result[0].reason.messageId === "CSIBT0033I") {
                    // at least one item requires consent
                    status = "consent";
                    continue;
                }
            }

            if (status == null) {
                status = "denied";
            }

            return { status: status, assessment };
        } catch (error) {
            const jsonResp = { status: 'error' };
            if (error.response.data) {
                jsonResp.detail = error.response.data;
                debug(`[${methodName}]`, 'error data:', error.response.data);
            } else {
                debug(`[${methodName}]`, 'error:', error);
            }
            return jsonResp;
        }
    }

    /**
     * The consent metadata record
     * @typedef {Object} module:Privacy~Consent
     * @property {string} purposeId The purpose or EULA ID representing the privacy
     * purpose or EULA configured on Verify.
     * @property {string} accessTypeId The access type ID representing the 
     * available access types on Verify. This is one of the access types configured
     * for the purpose and optionally the attribute.
     * @property {string} attributeId The attribute ID on Verify. This is one of the 
     * attributes for the purpose.
     * @property {string} attributeValue The attribute value for the attribute.
     * This is typically used when the user has more than one value for the attribute
     * and is consenting to a specific value.
     * @property {number} startTime The time since Epoch that indicates when the consent
     * becomes active.
     * @property {number} endTime The time since Epoch that indicates when the consent
     * elapses.
     * @property {boolean} isGlobal Indicates if the consent applies to all applications
     * @property {number} status This is the status of the consent and can be one of -
     * <br><code>1</code> - Active
     * <br><code>2</code> - Expired
     * <br><code>3</code> - Inactive
     * <br><code>8</code> - New consent required
     * @property {number} state This is the consent type provided by the user and can be one of -
     * <br><code>1</code> - Allow: Usual consent that is not governed by any regulation
     * <br><code>2</code> - Deny: Usual consent that is not governed by any regulation
     * <br><code>3</code> - Opt in: Consent type required based on the assessment
     * <br><code>4</code> - Opt out: Consent type required based on the assessment
     * <br><code>5</code> - Transparent: No explicit user consent
     * @property {string} geoIP This is the IP address where the user consents
     * @property {Array} customAttributes This is a list of optional attributes. Object type
     * within the array is <code>{ "key": "somekey", "value": "somevalue" }</code> 
     */

    /**
     * The consent metadata record
     * @typedef {Object} module:Privacy~MetadataRecord
     * @property {string} purposeId The purpose or EULA ID representing the privacy
     * purpose or EULA configured on Verify.
     * @property {string} purposeName The purpose or EULA name
     * @property {string} accessTypeId The access type ID representing the 
     * available access types on Verify. This is one of the access types configured
     * for the purpose and optionally the attribute.
     * @property {string} accessType The access type name
     * @property {string} attributeId The attribute ID on Verify. This is one of the 
     * attributes for the purpose.
     * @property {string} attributeName The attribute name
     * @property {number} defaultConsentDuration The default duration configured for the
     * user consent. This applies if no explicit start and end time is provided.
     * @property {boolean} assentUIDefault Indicates if the consent prompt should 
     * default the selection to "accepted"
     * @property {string} status The current status of consent. This can be one of -
     * <br><code>NONE</code> - No consent
     * <br><code>ACTIVE</code> - An active consent record exists. However, the consent may
     * not translate to "yes".
     * <br><code>EXPIRED</code> - A user consent record exists but it is no longer valid. This
     * may be due to a new privacy rule or a change in configuration or the consent has lapsed.
     * @property {module:Privacy~Consent} consent The user consent record that may or may not be active.
     */

    /**
     * The consent metadata object that contains records based on the request
     * @typedef {Object} module:Privacy~Metadata
     * @property {Array.<module:Privacy~MetadataRecord>} eula The metadata records related
     * to the EULA category
     * @property {Array.<module:Privacy~MetadataRecord>} default The metadata records related
     * to the default purpose-aware attribute category
     */

    /**
     * The consent metadata response object
     * @typedef {Object} module:Privacy~WrappedMetadata
     * @property {string} status The overall metadata status is computed based on whether
     * the data was received or not.
     * <br><code>done</code> - the metadata is retrieved
     * <br><code>error</code> - invalid request or system error
     * @property {module:Privacy~Metadata} metadata The metadata for rendering a consent page
     * @property {Object} detail The error details if the status is "error"
     * @property {string} detail.messageId Verify error code
     * @property {string} detail.messageDescription Localized description of the error
     */

    /**
     * Get consent metadata that can be used to build the consent page presented
     * to the data subject/user.
     *
     * This includes exhaustive information of the purposes, attributes and access
     * types and any other pertinent information needed to present a complete
     * consent page. Details such as current consents are also listed along with 
     * the current status of the consent.
     * 
     * If the metadata is retrieved successfully, the response status is 
     * <code>approved</code>. If the request is invalid or results in an 
     * overall failure, the response status is <code>error</code>.
     * 
     * @param {Array} items The data items that require approval for use
     * @param {string} items.purposeId The purpose ID representing the privacy
     * purpose configured on Verify. If you are checking for the consent status
     * of EULA, use the EULA identifier here.
     * @param {string} items.accessTypeId The access type ID representing the 
     * available access types on Verify. This must be one of the access types
     * selected for the purpose. If this is not provided in the input, it is 
     * defaulted to 'default'. Wildcards are not allowed.
     * @param {string} items.attributeId The attribute ID on Verify. This must be
     * configured as one of the attributes for the purpose. This may be optional if
     * no attributes are configured for the purpose. Wildcards are not allowed.
     * 
     * @return {Promise<module:Privacy~WrappedMetadata>} The status of the request
     * and any consent metadata
     */
    async getConsentMetadata(items) {
        const methodName = `${Privacy.name}:getConsentMetadata(items)`
        const service = new DPCMService(this._auth, this._config.tenantUrl, this._context)
        try {

            // retrieve the list of purposes
            let purposes = new Set();
            let itemNameSet = new Set();
            for (const item of items) {
                purposes.add(item.purposeId);

                if (!item['accessTypeId'] || item['accessTypeId'] == null) {
                    item.accessTypeId = "default";
                }

                itemNameSet.add(`${item.purposeId}/${StringUtils.getOrDefault(item.attributeId, "")}.${StringUtils.getOrDefault(item.accessTypeId, "")}`);
            }

            // get metadata
            const response = await service.getConsentMetadata(Array.from(purposes));
            debug(`[${methodName}]`, 'response:', response);

            // filter and normalize
            let metadata = await service.processConsentMetadata(itemNameSet, response);
            debug(`[${methodName}]`, 'metadata:', metadata);

            return { status: 'done', metadata };
        } catch (error) {
            const jsonResp = { status: 'error' };
            if (error.response.data) {
                jsonResp.detail = error.response.data;
                debug(`[${methodName}]`, 'error data:', error.response.data);
            } else {
                debug(`[${methodName}]`, 'error:', error);
            }
            return jsonResp;
        }
    }
}

module.exports = Privacy;
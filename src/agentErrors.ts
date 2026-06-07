const ERROR_MESSAGES: Record<string, string> = {
    'ECONNREFUSED': 'Cannot connect to the API server. Check baseUrl, network, and proxy settings.',
    'ECONNRESET': 'The API connection was reset. The network or upstream server may be unstable.',
    'ETIMEDOUT': 'The API request timed out. Check network speed, proxy, or provider status.',
    'ENOTFOUND': 'Cannot resolve the API host. Check baseUrl and DNS settings.',
    'socket hang up': 'The API connection closed unexpectedly. Try again shortly.',
    'DEPTH_ZERO_SELF_SIGNED_CERT': 'TLS certificate verification failed because the certificate is self-signed.',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE': 'TLS certificate verification failed. Check system time and certificate configuration.',
    '429': 'The API rate limit was reached.',
    '401': 'The API key is invalid or expired. Check your extension settings, environment variables, or ~/.mimo/settings.json.',
    '403': 'The API key does not have permission for this request or model.',
    '404': 'The API endpoint or model was not found. Check baseUrl and model settings.',
    '500': 'The API server returned an internal error. Try again shortly.',
    '502': 'The API gateway returned an error. The provider may be under maintenance.',
    '503': 'The API service is temporarily unavailable. Try again shortly.',
};

export function getFriendlyError(error: Error): string {
    const msg = error.message || '';

    for (const [pattern, friendly] of Object.entries(ERROR_MESSAGES)) {
        if (msg.includes(pattern)) {
            let result = `FAILED: ${friendly}`;

            if (msg.includes('429')) {
                const retryMatch = msg.match(/retry-after[:\s]+(\d+)/i);
                const waitTime = retryMatch ? parseInt(retryMatch[1]) : 30;
                result += `\n\nWait about ${waitTime} seconds and retry.`;
            }

            if (msg.includes('401') || msg.includes('403')) {
                result += '\n\nCheck the API key, baseUrl, selected model, and provider-side model permissions.';
            }

            return result;
        }
    }

    return `FAILED: ${msg}`;
}

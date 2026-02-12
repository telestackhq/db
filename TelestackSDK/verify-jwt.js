const crypto = require('crypto');

const secret = 'my_dev_secret';
const userId = 'test-user-123';

const header = { alg: 'HS256', typ: 'JWT' };
const payload = { sub: userId, iat: 1770802555, exp: 1770888955 };

function base64UrlEncode(obj) {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return Buffer.from(str)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

const encodedHeader = base64UrlEncode(header);
const encodedPayload = base64UrlEncode(payload);

const hmac = crypto.createHmac('sha256', secret);
hmac.update(`${encodedHeader}.${encodedPayload}`);
const signature = hmac.digest();
const encodedSignature = signature.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const token = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
console.log('JWT Token:', token);
console.log('Header:', encodedHeader);
console.log('Payload:', encodedPayload);
console.log('Signature:', encodedSignature);

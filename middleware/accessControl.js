// accessControl.js - Authentication and Authorization Middleware
const jwt = require('jsonwebtoken');

/**
 * Middleware to authenticate JWT tokens from multiple sources:
 * 1. Authorization header (Bearer token)
 * 2. Cookie (userToken)
 * 3. Query parameter (token)
 */
function authenticateToken(req, res, next) {
    // Check multiple sources for token
    const authHeader = req.headers['authorization'];
    const tokenFromHeader = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    const tokenFromCookie = req.cookies?.userToken; // From HTTP-only cookie
    const tokenFromQuery = req.query?.token; // From URL query string (fallback)
    
    // Priority: Header > Cookie > Query
    const token = tokenFromHeader || tokenFromCookie || tokenFromQuery;

    if (!token) {
        console.log('❌ No token provided in request');
        console.log('  - Header:', !!tokenFromHeader);
        console.log('  - Cookie:', !!tokenFromCookie);
        console.log('  - Query:', !!tokenFromQuery);
        
        // Check if it's an API request or page request
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ 
                success: false, 
                message: 'Access token required', 
                code: 'NO_TOKEN' 
            });
        } else {
            return res.redirect('/login?error=auth_required');
        }
    }

    // ✅ NEW: Sanitize token (remove potential whitespace/newlines)
    const cleanToken = token.trim();
    
    // ✅ NEW: Validate token format before verification
    const tokenParts = cleanToken.split('.');
    if (tokenParts.length !== 3) {
        console.error('❌ Token structure invalid');
        console.log('   Expected 3 parts (header.payload.signature), got:', tokenParts.length);
        console.log('   Token preview:', cleanToken.substring(0, 50) + '...');
        
        // Clear invalid cookie
        if (tokenFromCookie) {
            res.clearCookie('userToken', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                path: '/'
            });
        }
        
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({
                success: false,
                message: 'Token format is invalid',
                code: 'MALFORMED_TOKEN'
            });
        } else {
            return res.redirect('/login?error=token_invalid');
        }
    }

    // ✅ NEW: Log token info for debugging
    console.log('🔐 Token verification attempt:');
    console.log('   Source:', tokenFromHeader ? 'Header' : tokenFromCookie ? 'Cookie' : 'Query');
    console.log('   Length:', cleanToken.length);
    console.log('   Preview:', cleanToken.substring(0, 30) + '...');
    console.log('   Structure: ✅ Valid (3 parts)');

    // Verify the JWT token
    jwt.verify(cleanToken, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error('❌ Token verification failed:', err.message);
            console.log('   Error type:', err.name);
            
            // ✅ NEW: Enhanced error handling with specific messages
            let errorCode = 'INVALID_TOKEN';
            let errorMessage = 'Invalid or expired token';
            let redirectParam = 'session_expired';
            
            if (err.name === 'JsonWebTokenError') {
                if (err.message.includes('malformed')) {
                    console.error('⚠️ Token is malformed:');
                    console.error('   - Token might be corrupted during transmission');
                    console.error('   - Possible double-encoding');
                    console.error('   - Check JWT_SECRET consistency');
                    errorCode = 'MALFORMED_TOKEN';
                    errorMessage = 'Token format is corrupted';
                    redirectParam = 'token_corrupted';
                } else if (err.message.includes('invalid signature')) {
                    console.error('⚠️ Token signature invalid:');
                    console.error('   - JWT_SECRET mismatch');
                    console.error('   - Token might be tampered with');
                    errorCode = 'INVALID_SIGNATURE';
                    errorMessage = 'Token signature verification failed';
                    redirectParam = 'token_tampered';
                } else {
                    console.error('⚠️ General JWT error:', err.message);
                }
            } else if (err.name === 'TokenExpiredError') {
                console.error('⚠️ Token has expired');
                console.error('   Expired at:', err.expiredAt);
                errorCode = 'TOKEN_EXPIRED';
                errorMessage = 'Session expired, please login again';
                redirectParam = 'session_expired';
            } else if (err.name === 'NotBeforeError') {
                console.error('⚠️ Token not yet valid');
                console.error('   Valid from:', err.date);
                errorCode = 'TOKEN_NOT_ACTIVE';
                errorMessage = 'Token not yet active';
                redirectParam = 'token_early';
            }
            
            // ✅ NEW: Log token details for debugging
            console.log('   Token source:', tokenFromHeader ? 'Header' : tokenFromCookie ? 'Cookie' : 'Query');
            console.log('   Token first 50 chars:', cleanToken.substring(0, 50) + '...');
            console.log('   JWT_SECRET defined:', !!process.env.JWT_SECRET);
            console.log('   JWT_SECRET length:', process.env.JWT_SECRET?.length || 0);
            
            // Clear invalid cookie if it exists
            if (tokenFromCookie) {
                console.log('🗑️ Clearing invalid cookie');
                res.clearCookie('userToken', {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    path: '/'
                });
            }
            
            // Check if it's an API request or page request
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({
                    success: false,
                    message: errorMessage,
                    code: errorCode,
                    errorType: err.name
                });
            } else {
                return res.redirect(`/login?error=${redirectParam}`);
            }
        }
        
        // ✅ Token is valid - attach user info to request
        console.log('✅ Token verified successfully');
        console.log('   User ID:', decoded.userId);
        console.log('   Email:', decoded.email);
        console.log('   Plan:', decoded.currentPlan || 'N/A');
        console.log('   Issued at:', new Date(decoded.iat * 1000).toLocaleString());
        console.log('   Expires at:', decoded.exp ? new Date(decoded.exp * 1000).toLocaleString() : 'Never');
        
        req.user = decoded; // Contains { userId, email, plan, etc. }
        next();
    });
}


/**
 * Middleware to check if user has required subscription plan
 * @param {string|string[]} requiredPlans - Single plan or array of allowed plans
 */
function requirePlan(requiredPlans) {
    return (req, res, next) => {
        const userPlan = req.user?.subscriptionStatus || 'free';
        
        // Convert to array if single plan
        const allowedPlans = Array.isArray(requiredPlans) ? requiredPlans : [requiredPlans];
        
        if (allowedPlans.includes(userPlan)) {
            console.log(`✅ User has required plan: ${userPlan}`);
            next();
        } else {
            console.log(`❌ Access denied. Required: ${allowedPlans.join(' or ')}, User has: ${userPlan}`);
            
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({
                    success: false,
                    message: `This feature requires ${allowedPlans.join(' or ')} plan`,
                    code: 'INSUFFICIENT_PLAN',
                    userPlan: userPlan,
                    requiredPlans: allowedPlans
                });
            } else {
                return res.redirect('/plans?upgrade=required');
            }
        }
    };
}

/**
 * Middleware to check if user is an admin
 */
function requireAdmin(req, res, next) {
    const isAdmin = req.user?.role === 'admin' || req.user?.isAdmin === true;
    
    if (isAdmin) {
        console.log('✅ Admin access granted for:', req.user.email);
        next();
    } else {
        console.log('❌ Admin access denied for:', req.user?.email);
        
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({
                success: false,
                message: 'Admin access required',
                code: 'ADMIN_ONLY'
            });
        } else {
            return res.status(403).send('Access Denied: Admin privileges required');
        }
    }
}

/**
 * Optional authentication - adds user info if token exists, but doesn't block if missing
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const tokenFromHeader = authHeader && authHeader.split(' ')[1];
    const tokenFromCookie = req.cookies?.userToken;
    const token = tokenFromHeader || tokenFromCookie;

    if (!token) {
        console.log('ℹ️ No token provided (optional auth)');
        req.user = null;
        return next();
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log('⚠️ Invalid token in optional auth:', err.message);
            req.user = null;
        } else {
            console.log('✅ Optional auth successful for:', decoded.userId);
            req.user = decoded;
        }
        next();
    });
}

module.exports = {
    authenticateToken,
    requirePlan,
    requireAdmin,
    optionalAuth
};

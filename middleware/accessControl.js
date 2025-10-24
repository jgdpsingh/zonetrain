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
            // API request - return JSON error
            return res.status(401).json({ 
                success: false, 
                message: 'Access token required', 
                code: 'NO_TOKEN' 
            });
        } else {
            // Page request - redirect to login
            return res.redirect('/login?error=auth_required');
        }
    }

    // Verify the JWT token
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log('❌ Token verification failed:', err.message);
            
            // Clear invalid cookie if it exists
            if (tokenFromCookie) {
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
                    message: 'Invalid or expired token',
                    code: 'INVALID_TOKEN'
                });
            } else {
                return res.redirect('/login?error=session_expired');
            }
        }
        
        // Token is valid - attach user info to request
        console.log('✅ Token verified successfully for user:', decoded.userId);
        console.log('📋 Decoded token data:', decoded);
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

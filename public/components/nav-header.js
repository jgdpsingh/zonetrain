// ZoneTrain Universal Header - Fixed Version
(function() {
    // Prevent duplicate headers
    if (document.getElementById('zonetrain-nav-header')) return;

    // Check if user is logged in
    function isLoggedIn() {
        return !!localStorage.getItem('userToken');
    }

    // Get user email
    function getUserEmail() {
        return localStorage.getItem('userEmail') || 'Guest';
    }

    // Check current page
    function getCurrentPage() {
        const path = window.location.pathname;
        if (path === '/' || path === '/index.html') return 'home';
        if (path.includes('login')) return 'login';
        if (path.includes('signup')) return 'signup';
        if (path.includes('dashboard')) return 'dashboard';
        if (path.includes('about')) return 'about';
        if (path.includes('contact')) return 'contact';
        if (path.includes('plans')) return 'plans';
        return 'other';
    }

    // Create header HTML
    const headerHTML = `
    <header id="zonetrain-nav-header" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 70px;
        background: rgba(102, 126, 234, 0.95);
        backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 20px;
        z-index: 9998;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    ">
        <!-- Logo Section -->
        <a href="#" id="nav-logo" style="
            display: flex;
            align-items: center;
            gap: 12px;
            text-decoration: none;
            transition: transform 0.2s ease;
            flex-shrink: 0;
        ">
            <img src="/logo.jpeg" alt="ZoneTrain" id="logo-img" style="
                width: 40px;
                height: 40px;
                border-radius: 10px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                object-fit: cover;
                display: block;
            " onerror="this.style.display='none'; document.getElementById('logo-fallback').style.display='flex';">
            <div id="logo-fallback" style="
                width: 40px;
                height: 40px;
                background: white;
                border-radius: 10px;
                display: none;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                color: #667eea;
                font-size: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            ">Z</div>
            <span style="
                font-weight: 700;
                font-size: 22px;
                color: white;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">ZoneTrain</span>
        </a>

        <!-- Navigation Links -->
        <nav id="main-nav" style="
            display: flex;
            gap: 20px;
            align-items: center;
            overflow-x: auto;
            overflow-y: hidden;
            padding: 0 10px;
            flex: 1;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            -ms-overflow-style: none;
        ">
            <!-- Links will be inserted here by JS -->
        </nav>

        <div style="display: flex; gap: 12px; align-items: center; flex-shrink: 0;">
           <div style="position: relative;">
        <button id="calendar-btn" onclick="window.toggleCalendar(event)" style="
            position: relative;
            background: transparent;
            border: none;
            cursor: pointer;
            padding: 8px;
            border-radius: 50%;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        ">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
        </button>

        <!-- Calendar Dropdown Panel -->
        <div id="calendar-panel" style="
            display: none;
            position: absolute;
            right: 0;
            top: 50px;
            width: 320px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            overflow: hidden;
            z-index: 10001;
        ">
            <!-- Calendar content will be loaded here -->
            <div id="calendar-content"></div>
        </div>
    </div>
        
        <!-- ✅ Notification Bell -->
            <div style="position: relative;">
                <button id="notification-bell" onclick="window.toggleNotifications(event)" style="
                    position: relative;
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    padding: 8px;
                    border-radius: 50%;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <!-- Notification Badge -->
                    <span id="notification-badge" style="
                        display: none;
                        position: absolute;
                        top: 4px;
                        right: 4px;
                        background: #ef4444;
                        color: white;
                        font-size: 10px;
                        font-weight: 700;
                        padding: 2px 6px;
                        border-radius: 10px;
                        min-width: 18px;
                        text-align: center;
                        line-height: 1.2;
                        box-shadow: 0 2px 4px rgba(239, 68, 68, 0.4);
                    ">0</span>
                </button>

                <!-- Notification Panel (Dropdown) -->
                <div id="notification-panel" style="
                    display: none;
                    position: absolute;
                    right: 10px;
                    top: 75px;
                    width: 380px;
                    max-width: calc(100vw - 20px);
                    max-height: calc(100vh - 100px);
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                    overflow: hidden;
                    z-index: 10001;
                ">
                    <!-- Panel Header -->
                    <div style="
                        padding: 16px 20px;
                        border-bottom: 1px solid #e5e7eb;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background: white;
                    ">
                        <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: #1f2937;">Notifications</h3>
                        <button id="mark-all-read" style="
                            background: transparent;
                            border: none;
                            color: #667eea;
                            font-size: 13px;
                            font-weight: 600;
                            cursor: pointer;
                            padding: 4px 8px;
                            border-radius: 4px;
                            transition: background 0.2s;
                        ">Mark all read</button>
                    </div>

                    <!-- Notifications List -->
                    <div id="notifications-list" style="
                        max-height: 500px;
                        overflow-y: auto;
                        scrollbar-width: thin;
                        scrollbar-color: #d1d5db #ffffff;
                    ">
                        <!-- Loading state -->
                        <div id="notifications-loading" style="padding: 40px; text-align: center; color: #9ca3af;">
                            <div style="margin: 0 auto 12px; animation: spin 1s linear infinite; display: inline-block;">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                                </svg>
                            </div>
                            <p style="margin: 0; font-size: 14px;">Loading notifications...</p>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="
                        padding: 12px 20px;
                        border-top: 1px solid #e5e7eb;
                        text-align: center;
                        background: white;
                    ">
                        <a href="/notifications" style="
                            color: #667eea;
                            font-size: 14px;
                            font-weight: 600;
                            text-decoration: none;
                            transition: opacity 0.2s;
                        ">View All Notifications →</a>
                    </div>
                </div>
            </div>

        <!-- Profile Menu -->
        <div style="position: relative; flex-shrink: 0;">
            <div id="profile-trigger" style="
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: white;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            ">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
            </div>

            <!-- ✅ FIXED: Dropdown Menu with display block/none -->
            <div id="profile-dropdown" style="
                position: absolute;
                top: 55px;
                right: 0;
                min-width: 220px;
                max-height: calc(100vh - 85px);
                overflow-y: auto;
                overflow-x: hidden;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.15);
                display: none;
                z-index: 10000;
                -webkit-overflow-scrolling: touch;
            ">
                <div id="dropdown-content"></div>
            </div>
        </div>
    </header>

    <!-- Spacer -->
    <div style="height: 70px;"></div>

        <style>
    /* Hide scrollbar */
    #main-nav::-webkit-scrollbar {
        display: none;
    }

    .nav-link {
        color: white;
        text-decoration: none;
        font-weight: 500;
        font-size: 16px;
        transition: opacity 0.2s;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .nav-link:hover {
        opacity: 0.8;
    }

    .nav-link.active {
        opacity: 1;
        font-weight: 600;
        text-decoration: underline;
    }

    .menu-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 20px;
        color: #374151;
        text-decoration: none;
        font-size: 14px;
        font-weight: 500;
        transition: background 0.2s ease;
        cursor: pointer;
    }

    .menu-item:hover {
        background: #f3f4f6;
    }

    .menu-item svg {
        flex-shrink: 0;
    }

    /* Custom scrollbar styling for dropdown */
    #profile-dropdown {
        scrollbar-width: thin;
        scrollbar-color: #d1d5db #ffffff;
    }

    #profile-dropdown::-webkit-scrollbar {
        width: 6px;
    }

    #profile-dropdown::-webkit-scrollbar-track {
        background: #f3f4f6;
        border-radius: 10px;
    }

    #profile-dropdown::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 10px;
    }

    #profile-dropdown::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
    }

    /* Notification Animations */
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    @keyframes bell-ring {
        0%, 100% { transform: rotate(0deg); }
        10%, 30% { transform: rotate(-10deg); }
        20%, 40% { transform: rotate(10deg); }
    }

    /* Notification Bell Styles */
    #notification-bell:hover {
        background: rgba(255,255,255,0.1);
    }

    .notification-item {
        padding: 16px 20px;
        border-bottom: 1px solid #f3f4f6;
        cursor: pointer;
        transition: background 0.2s;
        position: relative;
    }

    .notification-item:hover {
        background: #f9fafb;
    }

    .notification-item.unread {
        background: #eff6ff;
    }

    .notification-item.unread:before {
        content: '';
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        width: 8px;
        height: 8px;
        background: #3b82f6;
        border-radius: 50%;
    }

    #mark-all-read:hover {
        background: #f3f4f6;
    }

    /* Custom scrollbar for notifications */
    #notifications-list::-webkit-scrollbar {
        width: 6px;
    }

    #notifications-list::-webkit-scrollbar-track {
        background: #f3f4f6;
    }

    #notifications-list::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 10px;
    }

    #notifications-list::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
    }

    /* Mobile-specific dropdown adjustments */
    @media screen and (max-height: 600px) {
        #profile-dropdown {
            max-height: calc(100vh - 75px);
        }
        
        .menu-item {
            padding: 10px 18px;
            font-size: 13px;
        }
    }

    /* Tablet Responsive */
    @media (max-width: 768px) {
        #zonetrain-nav-header {
            padding: 0 15px;
        }
        
        #nav-logo span {
            font-size: 18px;
        }
        
        #main-nav {
            gap: 15px;
            padding: 0 8px;
        }
        
        .nav-link {
            font-size: 14px;
        }

        /* ✅ Notification Panel - Tablet */
        #notification-panel {
            position: fixed !important;
            right: 10px !important;
            top: 75px !important;
            width: calc(100vw - 20px) !important;
            max-width: 400px !important;
        }
    }

    /* Mobile Responsive */
    @media (max-width: 576px) {
        #zonetrain-nav-header {
            padding: 0 10px;
        }
        
        #nav-logo div, #logo-fallback {
            width: 35px;
            height: 35px;
            font-size: 18px;
        }

        #logo-img {
            width: 35px;
            height: 35px;
        }
        
        #nav-logo span {
            font-size: 16px;
        }
        
        #main-nav {
            gap: 12px;
        }
        
        .nav-link {
            font-size: 13px;
        }
        
        #profile-trigger {
            width: 35px !important;
            height: 35px !important;
        }
        
        #profile-trigger svg {
            width: 20px;
            height: 20px;
        }

        /* ✅ Notification Bell - Mobile */
        #notification-bell {
            padding: 6px;
        }

        #notification-bell svg {
            width: 20px;
            height: 20px;
        }

        #notification-badge {
            top: 2px !important;
            right: 2px !important;
            font-size: 9px !important;
            padding: 1px 4px !important;
            min-width: 16px !important;
        }

        /* ✅ Notification Panel - Mobile Full Width */
        #notification-panel {
            position: fixed !important;
            right: 5px !important;
            left: 5px !important;
            top: 70px !important;
            width: auto !important;
            max-width: none !important;
            max-height: calc(100vh - 85px) !important;
            border-radius: 10px !important;
        }

        #notification-panel h3 {
            font-size: 16px !important;
        }

        .notification-item {
            padding: 12px 15px !important;
        }

        .notification-item h4 {
            font-size: 13px !important;
        }

        .notification-item p {
            font-size: 12px !important;
        }

        .notification-item > div > div:first-child {
            font-size: 20px !important;
        }

        #mark-all-read {
            font-size: 11px !important;
            padding: 3px 6px !important;
        }

        #notifications-list {
            max-height: calc(100vh - 180px) !important;
        }
    }

    /* Extra Small Mobile */
    @media (max-width: 400px) {
        #notification-panel {
            right: 3px !important;
            left: 3px !important;
            border-radius: 8px !important;
        }

        .notification-item {
            padding: 10px 12px !important;
        }

        .notification-item h4 {
            font-size: 12px !important;
        }

        .notification-item p {
            font-size: 11px !important;
        }
    }
    </style>

    `;

    // Wait for DOM to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        // Insert header
        document.body.insertAdjacentHTML('afterbegin', headerHTML);

        const loggedIn = isLoggedIn();
        const currentPage = getCurrentPage();
        const mainNav = document.getElementById('main-nav');
        const logoLink = document.getElementById('nav-logo');
        const profileTrigger = document.getElementById('profile-trigger');
        const dropdown = document.getElementById('profile-dropdown');

        // Build navigation links (hide on login/signup/dashboard)
        if (currentPage !== 'login' && currentPage !== 'signup' && currentPage !== 'dashboard') {
            mainNav.innerHTML = `
                <a href="/" class="nav-link ${currentPage === 'home' ? 'active' : ''}">Home</a>
                <a href="/about" class="nav-link ${currentPage === 'about' ? 'active' : ''}">About</a>
                <a href="/contact" class="nav-link ${currentPage === 'contact' ? 'active' : ''}">Contact</a>
            `;
        }

        // Build profile dropdown
        buildProfileDropdown(loggedIn);

      
// ✅ FIXED: Logo click handler with comprehensive plan-aware navigation
logoLink.addEventListener('click', function(e) {
  e.preventDefault();
  
  console.log('🏠 Logo clicked');
  console.log('   Current page:', currentPage);
  console.log('   Logged in:', loggedIn);
  
  // Check if user is logged in
  const token = localStorage.getItem('userToken');
  const currentPlan = localStorage.getItem('currentPlan');
  const subscriptionStatus = localStorage.getItem('subscriptionStatus');
  
  console.log('   Token exists:', !!token);
  console.log('   Current plan:', currentPlan);
  console.log('   Subscription status:', subscriptionStatus);
  
  // ✅ If on homepage and not logged in, just scroll to top
  if (currentPage === 'home' && !loggedIn && !token) {
    console.log('   Action: Scroll to top (homepage, not logged in)');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  
  // ✅ If logged in (or has token), navigate to dashboard
  if (loggedIn || token) {
    // Validate token
    if (!token || token === 'null' || token === 'undefined') {
      console.error('❌ Invalid token on logo click, clearing and redirecting to login');
      localStorage.clear();
      window.location.href = '/login?error=session_expired';
      return;
    }
    
    // Validate token structure (should have 3 parts: header.payload.signature)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      console.error('❌ Malformed token on logo click (expected 3 parts, got ' + tokenParts.length + ')');
      console.error('   Token preview:', token.substring(0, 50) + '...');
      localStorage.clear();
      window.location.href = '/login?error=token_invalid';
      return;
    }
    
    // ✅ Token is valid - navigate to appropriate dashboard based on plan
    console.log('✅ Valid token, navigating to dashboard');
    console.log('   Plan:', currentPlan || 'free (default)');
    
    // Determine which dashboard to navigate to
    let targetDashboard = '/dashboard'; // Default to free dashboard
    
    if (currentPlan === 'race') {
      targetDashboard = '/dashboard-race.html';
      console.log('   → Navigating to Race Coach dashboard');
    } else if (currentPlan === 'basic') {
      targetDashboard = '/dashboard-basic.html';
      console.log('   → Navigating to Basic Coach dashboard');
    } else {
      targetDashboard = '/dashboard'; // Free plan
      console.log('   → Navigating to Free dashboard');
    }
    
    // ✅ If already on the target dashboard, just scroll to top
    if (window.location.pathname === targetDashboard || 
        window.location.pathname === targetDashboard.replace('.html', '')) {
      console.log('   Already on target dashboard, scrolling to top');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      console.log('   Redirecting to:', targetDashboard);
      window.location.href = targetDashboard;
    }
    
    return;
  }
  
  // ✅ Not logged in - go to homepage
  console.log('   Action: Redirect to homepage (not logged in)');
  window.location.href = '/';
});



        // Logo hover
        logoLink.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.05)';
        });
        logoLink.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
        });

        // ✅ FIXED: Click-based dropdown toggle
        profileTrigger.addEventListener('click', function(e) {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            
            if (isVisible) {
                dropdown.style.display = 'none';
                profileTrigger.style.transform = 'scale(1)';
            } else {
                dropdown.style.display = 'block';
                profileTrigger.style.transform = 'scale(1.05)';
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (!dropdown.contains(e.target) && e.target !== profileTrigger) {
                dropdown.style.display = 'none';
                profileTrigger.style.transform = 'scale(1)';
            }
        });

        // Prevent dropdown from closing when clicking inside
        dropdown.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        // Build dropdown content
        function buildProfileDropdown(isLoggedIn) {
            const dropdownContent = document.getElementById('dropdown-content');
            
            if (isLoggedIn) {
                const userEmail = getUserEmail();
                dropdownContent.innerHTML = `
                    <div style="padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 3px;">Signed in as</div>
                        <div style="font-size: 13px; opacity: 0.9; overflow: hidden; text-overflow: ellipsis;">${userEmail}</div>
                    </div>
                    <div style="padding: 8px 0;">
                        <a href="/dashboard" class="menu-item">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="7" height="7"></rect>
                                <rect x="14" y="3" width="7" height="7"></rect>
                                <rect x="14" y="14" width="7" height="7"></rect>
                                <rect x="3" y="14" width="7" height="7"></rect>
                            </svg>
                            Dashboard
                        </a>
                        
                        <a href="/profile" class="menu-item">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            My Profile
                        </a>
                        <a href="/subscription" class="menu-item">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                                <line x1="1" y1="10" x2="23" y2="10"></line>
                            </svg>
                            Subscription
                        </a>
                        <hr style="margin: 8px 0; border: none; border-top: 1px solid #e5e7eb;">
                        <a href="#" id="logout-btn" class="menu-item" style="color: #ef4444;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                <polyline points="16 17 21 12 16 7"></polyline>
                                <line x1="21" y1="12" x2="9" y2="12"></line>
                            </svg>
                            Logout
                        </a>
                    </div>
                `;
                
                // Logout handler (find this in your code)
setTimeout(() => {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function(e) {
      e.preventDefault();
      
      console.log('👋 Logging out...');
      
      // ✅ Clear ALL storage
      localStorage.clear();
      sessionStorage.clear();
      
      // ✅ Clear all cookies
      document.cookie.split(";").forEach(function(c) { 
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
      });
      
      console.log('✅ All user data cleared');
      
      // ✅ Redirect to homepage
      window.location.href = '/';
    });
  }
}, 100);

            } else {
                dropdownContent.innerHTML = `
                    <div style="padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center;">
                        <div style="font-weight: 600; font-size: 16px;">Welcome to ZoneTrain</div>
                        <div style="font-size: 13px; opacity: 0.9; margin-top: 4px;">Sign in to access your training</div>
                    </div>
                    <div style="padding: 8px 0;">
                        <a href="/login" class="menu-item">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                                <polyline points="10 17 15 12 10 7"></polyline>
                                <line x1="15" y1="12" x2="3" y2="12"></line>
                            </svg>
                            Login
                        </a>
                        <a href="/signup" class="menu-item">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="8.5" cy="7" r="4"></circle>
                                <line x1="20" y1="8" x2="20" y2="14"></line>
                                <line x1="23" y1="11" x2="17" y2="11"></line>
                            </svg>
                            Sign Up
                        </a>
                        <hr style="margin: 8px 0; border: none; border-top: 1px solid #e5e7eb;">
                        
                        <a href="/about" class="menu-item">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>
                            About Us
                        </a>
                        <a href="/contact" class="menu-item">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                                <polyline points="22,6 12,13 2,6"></polyline>
                            </svg>
                            Contact
                        </a>
                    </div>
                `;
            }
        }
    

                   // ✅ NOTIFICATION BELL FUNCTIONALITY - FIXED VERSION
        if (loggedIn) {
            const notificationBell = document.getElementById('notification-bell');
            const notificationPanel = document.getElementById('notification-panel');
            const markAllReadBtn = document.getElementById('mark-all-read');
            
            // Only proceed if elements exist
            if (notificationBell && notificationPanel) {
                let notificationPanelOpen = false;

                // Toggle notification panel
                notificationBell.addEventListener('click', function(e) {
                    e.stopPropagation();
                    notificationPanelOpen = !notificationPanelOpen;
                    
                    if (notificationPanelOpen) {
                        notificationPanel.style.display = 'block';
                        if (dropdown) dropdown.style.display = 'none'; // Close profile dropdown
                        loadNotifications();
                    } else {
                        notificationPanel.style.display = 'none';
                    }
                });

                // Close notification panel when clicking outside
                document.addEventListener('click', function(e) {
                    if (notificationPanel && !notificationPanel.contains(e.target) && 
                        notificationBell && !notificationBell.contains(e.target)) {
                        notificationPanel.style.display = 'none';
                        notificationPanelOpen = false;
                    }
                });

                // Prevent panel from closing when clicking inside
                notificationPanel.addEventListener('click', function(e) {
                    e.stopPropagation();
                });

                // Mark all as read
                if (markAllReadBtn) {
                    markAllReadBtn.addEventListener('click', async function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        await markAllAsRead();
                    });
                }

                // Load notifications on page load (with delay)
                setTimeout(() => {
                    loadNotifications();
                }, 500);

                // Poll for new notifications every 60 seconds
                setInterval(loadNotifications, 60000);
            }
        }

        // ✅ NOTIFICATION FUNCTIONS - FIXED WITH NULL CHECKS
        async function loadNotifications() {
            const token = localStorage.getItem('userToken');
            const container = document.getElementById('notifications-list');
            
            if (!token || !container) return;
            
            try {
                const response = await fetch('/api/notifications', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (!response.ok) {
                    throw new Error('API request failed');
                }
                
                const data = await response.json();
                
                if (data.success) {
                    displayNotifications(data.notifications || []);
                    updateNotificationBadge(data.unreadCount || 0);
                } else {
                    // Show empty state if API returns error
                    displayNotifications([]);
                    updateNotificationBadge(0);
                }
            } catch (error) {
                console.error('Failed to load notifications:', error);
                // Show empty state instead of error message
                const container = document.getElementById('notifications-list');
                if (container) {
                    container.innerHTML = `
                        <div style="padding: 60px 20px; text-align: center; color: #9ca3af;">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                            </svg>
                            <p style="font-size: 16px; font-weight: 500; margin: 0 0 8px 0;">No notifications</p>
                            <p style="font-size: 14px; margin: 0;">You're all caught up! 🎉</p>
                        </div>
                    `;
                }
                updateNotificationBadge(0);
            }
        }

        function displayNotifications(notifications) {
            const container = document.getElementById('notifications-list');
            if (!container) return;
            
            // Check if notifications is undefined or empty
            if (!notifications || notifications.length === 0) {
                container.innerHTML = `
                    <div style="padding: 60px 20px; text-align: center; color: #9ca3af;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                        </svg>
                        <p style="font-size: 16px; font-weight: 500; margin: 0 0 8px 0;">No notifications</p>
                        <p style="font-size: 14px; margin: 0;">You're all caught up! 🎉</p>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = notifications.map(notif => `
                <div class="notification-item ${notif.read ? '' : 'unread'}" onclick="handleNotificationClick('${notif.id}')" style="${notif.read ? '' : 'padding-left: 32px;'}">
                    <div style="display: flex; gap: 12px; align-items: start;">
                        <div style="font-size: 24px; flex-shrink: 0;">${getNotificationIcon(notif.type)}</div>
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #1f2937;">${notif.title}</h4>
                            <p style="margin: 0 0 6px 0; font-size: 13px; color: #6b7280; line-height: 1.5; overflow: hidden; text-overflow: ellipsis;">${notif.message}</p>
                            <span style="font-size: 12px; color: #9ca3af;">${notif.timeAgo || 'Just now'}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        function getNotificationIcon(type) {
            const icons = {
                'workout': '🏃',
                'recovery': '💪',
                'payment': '💳',
                'upgrade': '🚀',
                'race': '🏁',
                'achievement': '🏆',
                'sync': '🔄',
                'zone': '🎯',
                'alert': '⚠️'
            };
            return icons[type] || '🔔';
        }

        function updateNotificationBadge(count) {
            const badge = document.getElementById('notification-badge');
            if (!badge) return;
            
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'block';
                
                // Animate bell
                const bell = document.getElementById('notification-bell');
                if (bell) {
                    bell.style.animation = 'bell-ring 0.5s ease';
                    setTimeout(() => {
                        bell.style.animation = '';
                    }, 500);
                }
            } else {
                badge.style.display = 'none';
            }
        }

        // Make handleNotificationClick globally accessible
        window.handleNotificationClick = async function(notificationId) {
            const token = localStorage.getItem('userToken');
            if (!token) return;
            
            // Mark as read
            try {
                await fetch(`/api/notifications/${notificationId}/read`, {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                // Reload notifications
                loadNotifications();
            } catch (error) {
                console.error('Failed to mark notification as read:', error);
            }
        };

        async function markAllAsRead() {
            const token = localStorage.getItem('userToken');
            if (!token) return;
            
            try {
                await fetch('/api/notifications/mark-all-read', {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                loadNotifications();
            } catch (error) {
                console.error('Failed to mark all as read:', error);
            }
        }}
    
                // ✅ GLOBAL NOTIFICATION TOGGLE (Inline onclick handler)
        window.toggleNotifications = function(e) {
            e.stopPropagation();
            console.log('🔔 BELL CLICKED VIA INLINE!');
            
            const panel = document.getElementById('notification-panel');
            const dropdown = document.getElementById('profile-dropdown');
            
            if (!panel) {
                console.log('❌ Panel not found');
                return;
            }
            
            const isHidden = panel.style.display === 'none' || panel.style.display === '';
            console.log('Panel hidden?', isHidden);
            
            if (isHidden) {
                panel.style.display = 'block';
                if (dropdown) dropdown.style.display = 'none';
                console.log('✅ Panel opened');
                
                // Load notifications
                if (window.loadNotificationsNow) {
                    window.loadNotificationsNow();
                } else {
                    // Show empty state
                    const list = document.getElementById('notifications-list');
                    if (list) {
                        list.innerHTML = `
                            <div style="padding: 60px 20px; text-align: center; color: #9ca3af;">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;">
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                                </svg>
                                <p style="font-size: 16px; font-weight: 500; margin: 0 0 8px 0;">No notifications</p>
                                <p style="font-size: 14px; margin: 0;">You're all caught up! 🎉</p>
                            </div>
                        `;
                    }
                }
            } else {
                panel.style.display = 'none';
                console.log('✅ Panel closed');
            }
        };
        
        // Close on outside click
        document.addEventListener('click', function(e) {
            const panel = document.getElementById('notification-panel');
            const bell = document.getElementById('notification-bell');
            
            if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
                panel.style.display = 'none';
            }
        });
        
        
        // Load notifications function
        window.loadNotificationsNow = function() {
            const token = localStorage.getItem('userToken');
            const list = document.getElementById('notifications-list');
            
            if (!token || !list) return;
            
            // Show empty state immediately
            list.innerHTML = `
                <div style="padding: 60px 20px; text-align: center; color: #9ca3af;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.5;">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <p style="font-size: 16px; font-weight: 500; margin: 0 0 8px 0;">No notifications</p>
                    <p style="font-size: 14px; margin: 0;">You're all caught up! 🎉</p>
                </div>
            `;
            
            // Try to fetch
            fetch('/api/notifications', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(res => res.json())
            .then(data => {
                if (data.success && data.notifications && data.notifications.length > 0) {
                    // Show real notifications
                    list.innerHTML = data.notifications.map(n => `
                        <div class="notification-item" style="padding: 16px 20px; border-bottom: 1px solid #f3f4f6;">
                            <div style="display: flex; gap: 12px;">
                                <div style="font-size: 24px;">🔔</div>
                                <div>
                                    <h4 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">${n.title}</h4>
                                    <p style="margin: 0; font-size: 13px; color: #6b7280;">${n.message}</p>
                                </div>
                            </div>
                        </div>
                    `).join('');
                }
            })
            .catch(() => {
                // Keep empty state on error
            });
        };   
    
})();

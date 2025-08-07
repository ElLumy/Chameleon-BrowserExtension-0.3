/**
 * Chameleon Content Script - FIXED VERSION
 * Main injection script with immediate message listener setup
 */

(async function() {
    'use strict';

    // Check if already injected
    if (window.__chameleon_injected) {
        return;
    }
    window.__chameleon_injected = true;

    console.log('[Chameleon] Initializing fingerprint spoofing...');

    // Setup message listener IMMEDIATELY before loading modules
    let profileData = null;
    let isInitialized = false;

    // Listen for messages from the extension popup or background FIRST
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('[Chameleon] Received message:', request.action);
        
        if (request.action === 'getProfile') {
            // Return current profile or a placeholder
            if (profileData) {
                sendResponse({ profile: profileData });
            } else {
                // Return a basic profile while modules are loading
                sendResponse({ 
                    profile: {
                        archetype: 'Initializing...',
                        os: { name: 'Loading...' },
                        userAgent: navigator.userAgent,
                        seed: 'pending'
                    }
                });
            }
            return true;
        } else if (request.action === 'regenerateProfile') {
            if (isInitialized) {
                // Trigger profile regeneration
                window.dispatchEvent(new CustomEvent('chameleon-regenerate'));
                sendResponse({ success: true });
            } else {
                // Can't regenerate yet, but acknowledge
                sendResponse({ success: false, reason: 'Not initialized' });
            }
            return true;
        } else if (request.action === 'getStatus') {
            sendResponse({ 
                initialized: isInitialized
            });
            return true;
        } else if (request.action === 'getDetectionStatus') {
            // Check if fingerprinting is detected
            sendResponse({ 
                isFingerprinting: false // Will be implemented with DetectionUtils
            });
            return true;
        } else if (request.action === 'setDebugMode') {
            window.__chameleon_debug_mode = request.enabled;
            sendResponse({ success: true });
            return true;
        }
        
        return false;
    });

    // Load modules using ES6 imports
    async function loadModules() {
        const modules = [
            'seedManager.js',
            'spoofingEngine.js',
            'utils/randomUtils.js',
            'utils/jitterUtils.js',
            'interceptors/metaInterceptor.js',
            'interceptors/navigatorInterceptor.js',
            'interceptors/screenInterceptor.js',
            'interceptors/canvasInterceptor.js',
            'interceptors/webglInterceptor.js',
            'interceptors/audioInterceptor.js',
            'interceptors/fontsInterceptor.js',
            'interceptors/pluginsInterceptor.js',
            'interceptors/timezoneInterceptor.js'
        ];

        // Create initialization code
        const initCode = `
            // Wait for all modules to load
            Promise.all([
                ${modules.map(m => `import('${chrome.runtime.getURL(m)}')`).join(',\n                ')}
            ]).then(modules => {
                // Assign modules to window
                const moduleNames = ${JSON.stringify(modules.map(m => m.split('/').pop().replace('.js', '')))};
                modules.forEach((mod, i) => {
                    window[moduleNames[i]] = mod.default || mod;
                });

                // Initialize Chameleon
                initializeChameleon();
            }).catch(err => {
                console.error('[Chameleon] Failed to load modules:', err);
                // Notify that initialization failed
                window.__chameleon_init_failed = true;
            });

            async function initializeChameleon() {
                try {
                    console.log('[Chameleon] Starting initialization...');
                    
                    // First, install the meta-interceptor to prevent detection
                    if (window.MetaInterceptor) {
                        window.MetaInterceptor.init();
                    }
                    
                    // Initialize seed manager
                    if (!window.SeedManager) {
                        console.error('[Chameleon] SeedManager not loaded');
                        window.__chameleon_init_failed = true;
                        return;
                    }
                    
                    // Initialize spoofing engine
                    if (!window.SpoofingEngine) {
                        console.error('[Chameleon] SpoofingEngine not loaded');
                        window.__chameleon_init_failed = true;
                        return;
                    }
                    
                    // Generate or retrieve profile for this session
                    const profile = await window.SpoofingEngine.init();
                    console.log('[Chameleon] Profile generated:', profile.archetype);
                    
                    // Store profile for message responses
                    window.__chameleon_profile = profile;
                    
                    // Notify content script that profile is ready
                    window.dispatchEvent(new CustomEvent('chameleon-profile-ready', {
                        detail: { profile: profile }
                    }));
                    
                    // Apply interceptors in order of priority
                    const interceptors = [
                        { name: 'Navigator', module: window.NavigatorInterceptor },
                        { name: 'Screen', module: window.ScreenInterceptor },
                        { name: 'Canvas', module: window.CanvasInterceptor },
                        { name: 'WebGL', module: window.WebGLInterceptor },
                        { name: 'Audio', module: window.AudioInterceptor },
                        { name: 'Fonts', module: window.FontsInterceptor },
                        { name: 'Plugins', module: window.PluginsInterceptor },
                        { name: 'Timezone', module: window.TimezoneInterceptor }
                    ];
                    
                    // Initialize each interceptor
                    for (const { name, module } of interceptors) {
                        if (module && typeof module.init === 'function') {
                            try {
                                module.init(profile);
                                console.log('[Chameleon]', name, 'interceptor initialized');
                            } catch (e) {
                                console.error('[Chameleon]', name, 'interceptor failed:', e);
                            }
                        } else {
                            console.warn('[Chameleon]', name, 'interceptor not available');
                        }
                    }
                    
                    // Add event listener for profile regeneration
                    window.addEventListener('chameleon-regenerate', async () => {
                        const newProfile = window.SpoofingEngine.regenerateProfile();
                        console.log('[Chameleon] Profile regenerated:', newProfile.archetype);
                        
                        // Update stored profile
                        window.__chameleon_profile = newProfile;
                        
                        // Notify content script
                        window.dispatchEvent(new CustomEvent('chameleon-profile-ready', {
                            detail: { profile: newProfile }
                        }));
                        
                        // Reinitialize all interceptors with new profile
                        for (const { name, module } of interceptors) {
                            if (module && typeof module.init === 'function') {
                                try {
                                    module.init(newProfile);
                                } catch (e) {
                                    console.error('[Chameleon]', name, 'reinitialization failed:', e);
                                }
                            }
                        }
                    });
                    
                    // Add event listener for profile requests
                    window.addEventListener('chameleon-get-profile', () => {
                        window.dispatchEvent(new CustomEvent('chameleon-profile-data', {
                            detail: window.__chameleon_profile
                        }));
                    });
                    
                    console.log('[Chameleon] ✓ All interceptors initialized successfully');
                    
                    // Set flag indicating successful initialization
                    window.__chameleon_initialized = true;
                    
                    // Dispatch event to notify that Chameleon is ready
                    window.dispatchEvent(new CustomEvent('chameleon-ready', {
                        detail: { profile: profile }
                    }));
                    
                } catch (error) {
                    console.error('[Chameleon] Initialization failed:', error);
                    window.__chameleon_initialized = false;
                    window.__chameleon_init_failed = true;
                }
            }

            // Protect against fingerprinting detection
            const protectAPIs = () => {
                // Prevent enumeration of our added properties
                const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
                Object.getOwnPropertyNames = function(obj) {
                    const props = originalGetOwnPropertyNames.call(this, obj);
                    // Filter out our internal properties
                    return props.filter(prop => !prop.startsWith('__chameleon'));
                };
                
                // Prevent detection via error stack traces
                const originalError = Error;
                window.Error = new Proxy(originalError, {
                    construct(target, args) {
                        const error = new target(...args);
                        if (error.stack) {
                            // Clean stack traces of our injected code
                            error.stack = error.stack
                                .split('\\n')
                                .filter(line => !line.includes('chameleon'))
                                .join('\\n');
                        }
                        return error;
                    }
                });
            };
            
            protectAPIs();
        `;

        // Create and inject the script
        const script = document.createElement('script');
        script.type = 'module';
        script.textContent = initCode;

        // Inject the script as early as possible
        if (document.documentElement) {
            document.documentElement.appendChild(script);
            script.remove();
        } else {
            // If documentElement doesn't exist yet, wait for it
            const observer = new MutationObserver((mutations, obs) => {
                if (document.documentElement) {
                    document.documentElement.appendChild(script);
                    script.remove();
                    obs.disconnect();
                }
            });
            observer.observe(document, { childList: true, subtree: true });
        }
    }

    // Listen for profile ready event from injected script
    window.addEventListener('chameleon-profile-ready', (event) => {
        profileData = event.detail.profile;
        isInitialized = true;
        console.log('[Chameleon] Profile data updated in content script');
    });

    // Listen for initialization complete
    window.addEventListener('chameleon-ready', (event) => {
        profileData = event.detail.profile;
        isInitialized = true;
        console.log('[Chameleon] Initialization complete');
    });

    // Load modules
    await loadModules();

    // Check initialization status periodically
    const checkInit = setInterval(() => {
        if (window.__chameleon_profile) {
            profileData = window.__chameleon_profile;
            isInitialized = true;
            clearInterval(checkInit);
            console.log('[Chameleon] Profile synchronized with injected context');
        } else if (window.__chameleon_init_failed) {
            clearInterval(checkInit);
            console.error('[Chameleon] Initialization failed permanently');
        }
    }, 100);

    // Stop checking after 5 seconds
    setTimeout(() => clearInterval(checkInit), 5000);

})();
// Main Application Component
class WeatherApp {
    constructor() {
        this.weatherService = new WeatherService();
        this.currentCity = null;
        this.components = {};
        
        this.init();
    }

    init() {
        // Initialize components
        this.initializeComponents();
        
        // Load default city
        this.loadWeatherData('New York');
        
        // Add geolocation support
        this.setupGeolocation();
    }

    initializeComponents() {
        // Get DOM elements
        const searchContainer = document.getElementById('search-container');
        const currentWeatherContainer = document.getElementById('current-weather');
        const forecastContainer = document.getElementById('forecast');
        
        // Initialize components
        this.components.search = new SearchComponent(searchContainer, (city) => {
            this.loadWeatherData(city);
        });
        
        this.components.currentWeather = new CurrentWeather(currentWeatherContainer);
        this.components.forecast = new WeatherForecast(forecastContainer);
    }

    async loadWeatherData(city) {
        try {
            // Show loading states
            this.components.currentWeather.showLoading();
            this.components.forecast.showLoading();
            
            // Update page title
            document.title = `Weather in ${city} - Weather App`;
            
            // Fetch data concurrently
            const [currentWeatherData, forecastData] = await Promise.all([
                this.weatherService.getCurrentWeather(city),
                this.weatherService.getForecast(city)
            ]);
            
            // Render components with data
            this.components.currentWeather.render(currentWeatherData);
            this.components.forecast.render(forecastData);
            
            // Update current city
            this.currentCity = city;
            
            // Save to localStorage
            this.saveLastCity(city);
            
            // Show success notification
            this.showNotification(`Weather data loaded for ${city}`, 'success');
            
        } catch (error) {
            console.error('Error loading weather data:', error);
            
            // Show error states
            this.components.currentWeather.showError('Unable to load weather data');
            this.components.forecast.showError('Unable to load forecast data');
            
            // Show error notification
            this.showNotification('Failed to load weather data. Please try again.', 'error');
        }
    }

    setupGeolocation() {
        const geolocationBtn = document.createElement('button');
        geolocationBtn.className = 'geolocation-btn';
        geolocationBtn.innerHTML = '📍 Use My Location';
        geolocationBtn.title = 'Get weather for your current location';
        
        geolocationBtn.addEventListener('click', () => {
            if (navigator.geolocation) {
                geolocationBtn.disabled = true;
                geolocationBtn.innerHTML = '📍 Getting location...';
                
                navigator.geolocation.getCurrentPosition(
                    async (position) => {
                        try {
                            // In a real app, you would use reverse geocoding
                            // For demo purposes, we'll use a default city
                            await this.loadWeatherData('London');
                            this.showNotification('Location detected! Showing weather for your area.', 'success');
                        } catch (error) {
                            this.showNotification('Could not get weather for your location.', 'error');
                        } finally {
                            geolocationBtn.disabled = false;
                            geolocationBtn.innerHTML = '📍 Use My Location';
                        }
                    },
                    (error) => {
                        this.showNotification('Location access denied. Please search manually.', 'error');
                        geolocationBtn.disabled = false;
                        geolocationBtn.innerHTML = '📍 Use My Location';
                    }
                );
            } else {
                this.showNotification('Geolocation is not supported by your browser.', 'error');
            }
        });
        
        // Add button to the search container
        const searchContainer = document.querySelector('.search-container');
        if (searchContainer) {
            searchContainer.appendChild(geolocationBtn);
        }
    }

    saveLastCity(city) {
        try {
            localStorage.setItem('lastCity', city);
        } catch (error) {
            console.warn('Could not save city to localStorage:', error);
        }
    }

    getLastCity() {
        try {
            return localStorage.getItem('lastCity');
        } catch (error) {
            console.warn('Could not read city from localStorage:', error);
            return null;
        }
    }

    showNotification(message, type = 'info') {
        // Remove existing notifications
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(notification => notification.remove());
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add to DOM
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Utility functions
function formatTime(timestamp) {
    return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDate(timestamp) {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });
}

function celsiusToFahrenheit(celsius) {
    return Math.round((celsius * 9/5) + 32);
}

function getWindDirection(degrees) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.weatherApp = new WeatherApp();
    
    // Add some keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + K to focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const searchInput = document.getElementById('cityInput');
            if (searchInput) {
                searchInput.focus();
            }
        }
        
        // Escape to clear search
        if (e.key === 'Escape') {
            const searchInput = document.getElementById('cityInput');
            const suggestions = document.getElementById('suggestions');
            if (searchInput) {
                searchInput.value = '';
                searchInput.blur();
            }
            if (suggestions) {
                suggestions.innerHTML = '';
            }
        }
    });
    
    // Add theme toggle
    const themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.innerHTML = '🌙';
    themeToggle.title = 'Toggle dark mode';
    
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        themeToggle.innerHTML = isDark ? '☀️' : '🌙';
        themeToggle.title = isDark ? 'Toggle light mode' : 'Toggle dark mode';
        
        // Save theme preference
        try {
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        } catch (error) {
            console.warn('Could not save theme preference:', error);
        }
    });
    
    // Load saved theme
    try {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-theme');
            themeToggle.innerHTML = '☀️';
            themeToggle.title = 'Toggle light mode';
        }
    } catch (error) {
        console.warn('Could not load theme preference:', error);
    }
    
    // Add theme toggle to header
    const header = document.querySelector('header') || document.body;
    header.appendChild(themeToggle);
});

// Export for testing
window.WeatherApp = WeatherApp;
window.formatTime = formatTime;
window.formatDate = formatDate;
window.celsiusToFahrenheit = celsiusToFahrenheit;
window.getWindDirection = getWindDirection;

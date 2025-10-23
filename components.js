// Current Weather Component
class CurrentWeather {
    constructor(container) {
        this.container = container;
        this.weatherData = null;
    }

    render(data) {
        this.weatherData = data;
        this.container.innerHTML = `
            <div class="current-weather">
                <div class="weather-header">
                    <h2>${data.name}</h2>
                    <div class="weather-icon">
                        <img src="https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png" 
                             alt="${data.weather[0].description}">
                    </div>
                </div>
                <div class="temperature">
                    <span class="temp-main">${Math.round(data.main.temp)}°C</span>
                    <span class="feels-like">Feels like ${Math.round(data.main.feels_like)}°C</span>
                </div>
                <div class="weather-description">
                    <p>${data.weather[0].description}</p>
                </div>
                <div class="weather-details">
                    <div class="detail-item">
                        <span class="detail-label">Humidity</span>
                        <span class="detail-value">${data.main.humidity}%</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Wind Speed</span>
                        <span class="detail-value">${data.wind.speed} m/s</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Pressure</span>
                        <span class="detail-value">${data.main.pressure} hPa</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Visibility</span>
                        <span class="detail-value">${(data.visibility / 1000).toFixed(1)} km</span>
                    </div>
                </div>
            </div>
        `;
    }

    showLoading() {
        this.container.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading weather data...</p>
            </div>
        `;
    }

    showError(message) {
        this.container.innerHTML = `
            <div class="error">
                <p>❌ ${message}</p>
            </div>
        `;
    }
}

// Weather Forecast Component
class WeatherForecast {
    constructor(container) {
        this.container = container;
        this.forecastData = null;
    }

    render(data) {
        this.forecastData = data;
        const dailyForecasts = this.groupByDay(data.list);
        
        this.container.innerHTML = `
            <div class="forecast">
                <h3>5-Day Forecast</h3>
                <div class="forecast-grid">
                    ${dailyForecasts.map(day => this.createForecastCard(day)).join('')}
                </div>
            </div>
        `;
    }

    groupByDay(forecastList) {
        const dailyData = {};
        
        forecastList.forEach(item => {
            const date = new Date(item.dt * 1000);
            const dateKey = date.toLocaleDateString();
            
            if (!dailyData[dateKey]) {
                dailyData[dateKey] = {
                    date: date,
                    temp_min: item.main.temp_min,
                    temp_max: item.main.temp_max,
                    temp_sum: item.main.temp,
                    count: 1,
                    humidity: item.main.humidity,
                    wind_speed: item.wind.speed,
                    weather: item.weather[0]
                };
            } else {
                dailyData[dateKey].temp_min = Math.min(dailyData[dateKey].temp_min, item.main.temp_min);
                dailyData[dateKey].temp_max = Math.max(dailyData[dateKey].temp_max, item.main.temp_max);
                dailyData[dateKey].temp_sum += item.main.temp;
                dailyData[dateKey].count += 1;
            }
        });

        return Object.values(dailyData).slice(0, 5);
    }

    createForecastCard(dayData) {
        const avgTemp = Math.round(dayData.temp_sum / dayData.count);
        const date = dayData.date.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        });

        return `
            <div class="forecast-card">
                <div class="forecast-date">${date}</div>
                <div class="forecast-icon">
                    <img src="https://openweathermap.org/img/wn/${dayData.weather.icon}.png" 
                         alt="${dayData.weather.description}">
                </div>
                <div class="forecast-temp">
                    <span class="temp-high">${Math.round(dayData.temp_max)}°</span>
                    <span class="temp-low">${Math.round(dayData.temp_min)}°</span>
                </div>
                <div class="forecast-desc">${dayData.weather.description}</div>
                <div class="forecast-details">
                    <span>💧 ${dayData.humidity}%</span>
                    <span>💨 ${dayData.wind_speed} m/s</span>
                </div>
            </div>
        `;
    }

    showLoading() {
        this.container.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading forecast...</p>
            </div>
        `;
    }

    showError(message) {
        this.container.innerHTML = `
            <div class="error">
                <p>❌ ${message}</p>
            </div>
        `;
    }
}

// Search Component
class SearchComponent {
    constructor(container, onSearch) {
        this.container = container;
        this.onSearch = onSearch;
        this.render();
    }

    render() {
        this.container.innerHTML = `
            <div class="search-container">
                <form class="search-form" id="searchForm">
                    <input 
                        type="text" 
                        id="cityInput" 
                        class="search-input" 
                        placeholder="Enter city name..."
                        autocomplete="off"
                        required
                    >
                    <button type="submit" class="search-button">
                        🔍 Search
                    </button>
                </form>
                <div class="search-suggestions" id="suggestions"></div>
            </div>
        `;

        this.attachEventListeners();
    }

    attachEventListeners() {
        const form = document.getElementById('searchForm');
        const input = document.getElementById('cityInput');
        const suggestions = document.getElementById('suggestions');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const city = input.value.trim();
            if (city) {
                this.onSearch(city);
                suggestions.innerHTML = '';
                input.value = '';
            }
        });

        // Add autocomplete functionality
        const cities = ['New York', 'London', 'Tokyo', 'Paris', 'Berlin', 'Sydney', 'Moscow', 'Beijing', 'Mumbai', 'Cairo'];
        
        input.addEventListener('input', (e) => {
            const value = e.target.value.toLowerCase();
            if (value.length > 0) {
                const matches = cities.filter(city => 
                    city.toLowerCase().includes(value)
                ).slice(0, 5);

                if (matches.length > 0) {
                    suggestions.innerHTML = matches.map(city => `
                        <div class="suggestion-item" data-city="${city}">
                            ${city}
                        </div>
                    `).join('');

                    suggestions.querySelectorAll('.suggestion-item').forEach(item => {
                        item.addEventListener('click', () => {
                            this.onSearch(item.dataset.city);
                            suggestions.innerHTML = '';
                            input.value = '';
                        });
                    });
                } else {
                    suggestions.innerHTML = '';
                }
            } else {
                suggestions.innerHTML = '';
            }
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                suggestions.innerHTML = '';
            }
        });
    }
}

// Export components
window.CurrentWeather = CurrentWeather;
window.WeatherForecast = WeatherForecast;
window.SearchComponent = SearchComponent;

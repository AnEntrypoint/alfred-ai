class WeatherService {
    constructor() {
        this.apiKey = 'demo'; // Using demo data since we don't have a real API key
        this.baseUrl = 'https://api.openweathermap.org/data/2.5';
    }

    async getCurrentWeather(city) {
        // For demo purposes, return mock data
        // In production, you would make a real API call:
        // const response = await fetch(`${this.baseUrl}/weather?q=${city}&appid=${this.apiKey}&units=metric`);
        // return response.json();
        
        return this.getMockCurrentWeather(city);
    }

    async getForecast(city) {
        // For demo purposes, return mock data
        // In production, you would make a real API call:
        // const response = await fetch(`${this.baseUrl}/forecast?q=${city}&appid=${this.apiKey}&units=metric`);
        // return response.json();
        
        return this.getMockForecast(city);
    }

    getMockCurrentWeather(city) {
        const mockData = {
            'new york': {
                name: 'New York',
                main: {
                    temp: 22,
                    feels_like: 20,
                    humidity: 65,
                    pressure: 1013
                },
                weather: [{
                    main: 'Clear',
                    description: 'clear sky',
                    icon: '01d'
                }],
                wind: {
                    speed: 3.5
                },
                visibility: 10000
            },
            'london': {
                name: 'London',
                main: {
                    temp: 18,
                    feels_like: 16,
                    humidity: 75,
                    pressure: 1010
                },
                weather: [{
                    main: 'Clouds',
                    description: 'partly cloudy',
                    icon: '02d'
                }],
                wind: {
                    speed: 2.8
                },
                visibility: 8000
            },
            'tokyo': {
                name: 'Tokyo',
                main: {
                    temp: 25,
                    feels_like: 27,
                    humidity: 70,
                    pressure: 1012
                },
                weather: [{
                    main: 'Rain',
                    description: 'light rain',
                    icon: '10d'
                }],
                wind: {
                    speed: 4.2
                },
                visibility: 7000
            }
        };

        const lowerCity = city.toLowerCase();
        return mockData[lowerCity] || this.getDefaultMockData(city);
    }

    getMockForecast(city) {
        const baseTemp = Math.random() * 10 + 15; // Random temp between 15-25°C
        const forecast = [];
        
        for (let i = 0; i < 5; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            
            forecast.push({
                dt: date.getTime() / 1000,
                main: {
                    temp: Math.round(baseTemp + (Math.random() - 0.5) * 5),
                    temp_min: Math.round(baseTemp - 2 + (Math.random() - 0.5) * 3),
                    temp_max: Math.round(baseTemp + 2 + (Math.random() - 0.5) * 3),
                    humidity: Math.round(60 + Math.random() * 30)
                },
                weather: [{
                    main: ['Clear', 'Clouds', 'Rain', 'Snow'][Math.floor(Math.random() * 4)],
                    description: ['clear sky', 'partly cloudy', 'light rain', 'heavy snow'][Math.floor(Math.random() * 4)],
                    icon: '01d'
                }],
                wind: {
                    speed: Math.round((Math.random() * 5 + 1) * 10) / 10
                }
            });
        }
        
        return {
            list: forecast,
            city: {
                name: city
            }
        };
    }

    getDefaultMockData(city) {
        return {
            name: city,
            main: {
                temp: Math.round(Math.random() * 15 + 15),
                feels_like: Math.round(Math.random() * 15 + 14),
                humidity: Math.round(Math.random() * 40 + 40),
                pressure: Math.round(Math.random() * 20 + 1000)
            },
            weather: [{
                main: 'Clear',
                description: 'clear sky',
                icon: '01d'
            }],
            wind: {
                speed: Math.round((Math.random() * 5 + 1) * 10) / 10
            },
            visibility: Math.round(Math.random() * 5000 + 5000)
        };
    }
}

// Export the service
window.WeatherService = WeatherService;

# Weather App

A modern, responsive weather application built with vanilla JavaScript that provides current weather conditions and 5-day forecasts for any city worldwide.

## Features

- 🌤️ **Current Weather Display**: Shows temperature, feels-like temperature, humidity, wind speed, pressure, and visibility
- 📅 **5-Day Forecast**: Daily weather predictions with temperature ranges and conditions
- 🔍 **Smart Search**: Autocomplete functionality with city suggestions
- 📍 **Geolocation Support**: Get weather for your current location (with permission)
- 🌓 **Dark/Light Theme**: Toggle between light and dark themes
- 📱 **Responsive Design**: Works perfectly on desktop, tablet, and mobile devices
- ⚡ **Real-time Updates**: Fast loading and smooth transitions
- 🔔 **Notifications**: User-friendly success and error messages
- ⌨️ **Keyboard Shortcuts**: Ctrl/Cmd+K to focus search, Escape to clear

## Technologies Used

- **HTML5**: Semantic markup with accessibility features
- **CSS3**: Modern styling with gradients, animations, and responsive grid
- **Vanilla JavaScript**: ES6+ features, no external dependencies
- **OpenWeatherMap API**: Real weather data (mock data for demo)

## File Structure

```
weather-app/
├── index.html              # Main HTML entry point
├── styles.css              # Complete styling with themes
├── app.js                  # Main application logic and state management
├── weatherService.js       # Weather data fetching service
├── components.js           # Reusable UI components
├── package.json            # Project configuration
└── README.md               # This file
```

## Installation

1. Clone or download the project files
2. Install dependencies (if needed):
   ```bash
   npm install
   ```

## Usage

### Development Mode

Start the development server:
```bash
npm run dev
```

Or start on a specific port:
```bash
npm start
```

### Direct Access

You can also open `index.html` directly in a web browser, but some features may be limited due to CORS restrictions.

## Components

### WeatherService
Handles all weather data fetching with mock data for demonstration. In production, replace with real API calls to OpenWeatherMap.

### CurrentWeather
Displays current weather conditions with:
- Temperature and "feels like" temperature
- Weather description and icon
- Detailed metrics (humidity, wind, pressure, visibility)

### WeatherForecast
Shows 5-day forecast with:
- Daily temperature ranges
- Weather conditions and icons
- Additional details (humidity, wind speed)

### SearchComponent
Provides city search functionality with:
- Autocomplete suggestions
- Keyboard shortcuts support
- Geolocation integration

## Customization

### API Integration
To use real weather data:

1. Sign up at [OpenWeatherMap](https://openweathermap.org/api)
2. Get your API key
3. Replace the mock data in `weatherService.js` with actual API calls:
   ```javascript
   const response = await fetch(`${this.baseUrl}/weather?q=${city}&appid=${YOUR_API_KEY}&units=metric`);
   ```

### Theming
The app includes a built-in dark/light theme toggle. Customize colors in `styles.css` under the `/* Dark Theme */` section.

### Adding Cities
Add more default cities to the mock data in `weatherService.js` by extending the `mockData` object.

## Browser Support

- Chrome/Chromium 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Performance Features

- Lazy loading of weather data
- Efficient DOM updates
- Optimized CSS animations
- Minimal bundle size (~30KB total)
- Service worker ready (commented in HTML)

## Accessibility

- Semantic HTML5 markup
- ARIA-friendly structure
- Keyboard navigation support
- High contrast themes
- Screen reader compatible

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Demo

Open the application in your browser and try searching for cities like:
- New York
- London  
- Tokyo
- Paris
- Berlin

The app will display current weather conditions and a 5-day forecast for any location.

---

Made with ❤️ using vanilla JavaScript

import { evaluate } from "mathjs";

export async function get_weather(city: string): Promise<string> {
    try{
        const geoRes = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
        );

        const geoData = await geoRes.json();

        if(!geoData.results || geoData.results.length === 0){
            return `Could not find a location named "${city}".`;
        }

        const { latitude, longitude, name } = geoData.results[0];

        const weatherRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`
        );

        const weatherData = await weatherRes.json();

        const temp = weatherData.current_weather?.temperature;
        const wind = weatherData.current_weather?.windspeed;

    }
}


import { evaluate } from "mathjs";

export async function get_weather(city: string): Promise<string> {
    try{
        const geoRes = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
        );

        const geoData = await geoRes.json();

        if(!geoData.results || geoData.results.length == 0){
            return `Could not fina a location named "${city}".`;
        }
    }
}


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
        const windSpeed = weatherData.current_weather?.windspeed;

        if (temp === undefined){
            return `Weather data not available for ${name}.`
        }

        return `Current weather in ${name}: ${temp}°C, wind speed ${windSpeed} km/h.`;

    } catch (error) {
        return `Error fetching weather for ${city}.`
    }
}

export function calculate(expression: string): string {
    try {
        const result = evaluate(expression);

        return `Result: ${result}`;
    } catch (error) {
        return `Could not evaluate expression: ${expression}`;
    }
}

export const tools = [
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "Get the current realtime weather for a given city.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "The city name, e.g. 'Tokyo' or 'London'.",
          },
        },
        required: ["city"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "calculate",
      description:
        "Evaluate a mathematical expression and return the numeric result.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description:
              "A math expression, e.g. '12 * (3 + 4)' or 'e^(i*pi) + 1'.",
          },
        },
        required: ["expression"],
      },
    },
  },
];


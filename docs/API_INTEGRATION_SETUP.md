# API Integration Setup Guide

This guide explains how to configure the real API integrations for RestaurantIQ.

## ⚠️ Security Notice

**NEVER commit `.env.local` to git.** This file contains sensitive API keys and secrets. It's already in `.gitignore`.

## Required API Keys

### 1. OpenWeather API
- **Purpose**: Real-time weather data for demand forecasting
- **Get API Key**: https://openweathermap.org/api
- **Free Tier**: 1,000 calls/day, 60 calls/minute
- **Environment Variable**: `OPENWEATHER_API_KEY`

**Setup Steps**:
1. Sign up at https://openweathermap.org/api
2. Go to "My API Keys" in your account
3. Copy your API key
4. Add to `.env.local`: `OPENWEATHER_API_KEY=your_key_here`

### 2. Google Maps API
- **Purpose**: Geocoding, Places API for nearby restaurant data
- **Get API Key**: https://console.cloud.google.com/apis/credentials
- **Environment Variable**: `GOOGLE_MAPS_API_KEY`

**Setup Steps**:
1. Go to Google Cloud Console
2. Create a new project or select existing
3. Enable APIs:
   - Maps JavaScript API
   - Places API
   - Geocoding API
4. Create credentials → API Key
5. Add to `.env.local`: `GOOGLE_MAPS_API_KEY=your_key_here`

### 3. Uber Eats API
- **Purpose**: Order management, menu synchronization, store operations
- **Get Access**: https://developer.uber.com/docs/eats
- **Environment Variables**:
  - `UBEREATS_CLIENT_ID`
  - `UBEREATS_CLIENT_SECRET`
  - `UBEREATS_STORE_IDS` (optional, for server token mode)

**Setup Steps**:

#### Option A: OAuth Flow (Recommended for Production)
1. Apply for Uber Eats Developer access at https://developer.uber.com
2. Create an app in the Uber Developer Dashboard
3. Configure OAuth redirect URI: `https://your-domain.com/api/integrations/ubereats/callback`
4. Add to `.env.local`:
   ```
   UBEREATS_CLIENT_ID=your_client_id
   UBEREATS_CLIENT_SECRET=your_client_secret
   UBEREATS_USE_SERVER_TOKEN=false
   ```

#### Option B: Server Token Mode (Simpler for Testing)
1. Get a server token from Uber Eats
2. Add to `.env.local`:
   ```
   UBEREATS_BEARER_TOKEN=your_server_token
   UBEREATS_USE_SERVER_TOKEN=true
   UBEREATS_STORE_IDS=store_id_1,store_id_2
   ```

### 4. OpenAI API
- **Purpose**: AI-powered analysis, recommendations, and operations
- **Get API Key**: https://platform.openai.com/api-keys
- **Environment Variable**: `OPENAI_API_KEY`

**Setup Steps**:
1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Add to `.env.local`: `OPENAI_API_KEY=sk-proj-...`

## Configuration File

Create or update `.env.local` in your project root:

```bash
# App Configuration
NEXT_PUBLIC_APP_NAME=Restaurant IQ
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_USE_MOCK_DATA=false

# OpenWeather API
OPENWEATHER_API_KEY=<redacted — see the password manager>

# Google Maps API
GOOGLE_MAPS_API_KEY=<redacted — see the password manager>

# OpenAI API
OPENAI_API_KEY=<redacted — see the password manager>

# Uber Eats (choose one mode)
UBEREATS_CLIENT_ID=your_client_id
UBEREATS_CLIENT_SECRET=your_client_secret
UBEREATS_USE_SERVER_TOKEN=false
# OR for server token mode:
# UBEREATS_BEARER_TOKEN=your_server_token
# UBEREATS_USE_SERVER_TOKEN=true
# UBEREATS_STORE_IDS=store_id_1,store_id_2
```

## Testing the Integrations

### 1. Test Weather API
```bash
curl "https://api.openweathermap.org/data/2.5/weather?q=San Francisco&appid=YOUR_OPENWEATHER_KEY&units=metric"
```

### 2. Test Google Maps API
```bash
curl "https://maps.googleapis.com/maps/api/geocode/json?address=San+Francisco&key=YOUR_GOOGLE_KEY"
```

### 3. Test OpenAI API
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_OPENAI_KEY"
```

## Uber Eats OAuth Flow

The app already has a complete OAuth flow implemented:

1. **User clicks "Connect Uber Eats"** → Redirects to `/api/integrations/ubereats/start`
2. **Uber authorization page** → User logs in and grants permissions
3. **Callback** → Redirects to `/api/integrations/ubereats/callback`
4. **Token exchange** → Server exchanges authorization code for access token
5. **Redirect to dashboard** → User sees real Uber Eats data

### Required Scopes
- `eats.store.read` - Read store information
- `eats.store.orders.read` - Read orders
- `eats.store.status.write` - Update store status
- `eats.store.orders.write` - Accept/reject orders
- `eats.pos_provisioning` - Menu synchronization

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENWEATHER_API_KEY` | Yes | OpenWeather API key |
| `GOOGLE_MAPS_API_KEY` | Yes | Google Maps API key |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `UBEREATS_CLIENT_ID` | OAuth mode | Uber Eats OAuth client ID |
| `UBEREATS_CLIENT_SECRET` | OAuth mode | Uber Eats OAuth client secret |
| `UBEREATS_BEARER_TOKEN` | Server token mode | Uber Eats server token |
| `UBEREATS_USE_SERVER_TOKEN` | Yes | Set to `true` for server token mode |
| `UBEREATS_STORE_IDS` | Server token mode | Comma-separated store IDs |
| `NEXT_PUBLIC_USE_MOCK_DATA` | Yes | Set to `false` to use real APIs |

## Troubleshooting

### Weather Data Not Loading
- Check `OPENWEATHER_API_KEY` is set correctly
- Verify API key is active at https://openweathermap.org/api
- Check browser console for errors

### Google Maps Errors
- Verify `GOOGLE_MAPS_API_KEY` is set
- Check that required APIs are enabled in Google Cloud Console
- Ensure billing is enabled for your Google Cloud project

### Uber Eats Connection Fails
- Verify client ID and secret are correct
- Check redirect URI matches in Uber Developer Dashboard
- Ensure app is approved for required scopes
- Check server logs for detailed error messages

### OpenAI API Errors
- Verify `OPENAI_API_KEY` is valid
- Check that you have available credits
- Ensure the key has the correct permissions

## Security Best Practices

1. **Never commit `.env.local`** - It's in `.gitignore`
2. **Rotate API keys regularly** - Especially if compromised
3. **Use environment-specific keys** - Different keys for dev/staging/prod
4. **Monitor API usage** - Set up alerts for unusual activity
5. **Limit API key permissions** - Only grant necessary scopes

## Next Steps

1. ✅ Add API keys to `.env.local`
2. ✅ Restart the development server: `npm run dev`
3. ✅ Test each integration in the app
4. ✅ Monitor API usage in respective dashboards
5. ✅ Set up rate limiting and error handling

## Support

For issues with specific APIs:
- OpenWeather: https://openweathermap.org/support
- Google Maps: https://developers.google.com/maps/support
- Uber Eats: https://developer.uber.com/support
- OpenAI: https://help.openai.com/
/**
 * Notion Integration
 * Synct Leads automatisch zur "Restaurant Leads Paderborn" Datenbank
 * Notion API Key wird aus .env gelesen
 */

require('dotenv').config();
const axios = require('axios');

const NOTION_DB_ID = process.env.NOTION_DB_ID; // aus .env
const NOTION_TOKEN = process.env.NOTION_TOKEN;

function notionHeaders() {
  return {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
}

/**
 * Neuen Lead in Notion anlegen
 */
async function syncLeadToNotion(lead) {
  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    console.log('Notion nicht konfiguriert — überspringe Sync');
    return null;
  }

  try {
    const res = await axios.post('https://api.notion.com/v1/pages', {
      parent: { database_id: NOTION_DB_ID },
      properties: {
        'Name': { title: [{ text: { content: lead.name || '' } }] },
        'Status': { select: { name: 'Neu' } },
        'Priorität': { select: { name: lead.priority === 'high' ? 'Hoch' : lead.priority === 'medium' ? 'Mittel' : 'Niedrig' } },
        'Website': lead.website ? { url: lead.website } : undefined,
        'Website-Problem': { rich_text: [{ text: { content: lead.websiteIssues || '' } }] },
        'Telefon': lead.phone ? { phone_number: lead.phone } : undefined,
        'Adresse': { rich_text: [{ text: { content: lead.address || '' } }] },
        'Bewertung': lead.rating ? { number: lead.rating } : undefined,
        'Bewertungen Anzahl': lead.reviewCount ? { number: lead.reviewCount } : undefined,
        'Google Maps': lead.googleMapsUrl ? { url: lead.googleMapsUrl } : undefined,
        'Pitch-Text': { rich_text: [{ text: { content: lead.pitchText || '' } }] },
      }
    }, { headers: notionHeaders() });

    console.log(`✅ Notion: "${lead.name}" angelegt`);
    return res.data.id;
  } catch (e) {
    console.error('Notion Sync Fehler:', e.response?.data?.message || e.message);
    return null;
  }
}

/**
 * Status in Notion updaten
 */
async function updateNotionStatus(notionPageId, status, demoUrl = null) {
  if (!NOTION_TOKEN || !notionPageId) return;

  const statusMap = {
    'new': 'Neu', 'draft': 'Entwurf', 'contacted': 'Kontaktiert',
    'offer_sent': 'Angebot gesendet', 'won': 'Gewonnen', 'lost': 'Verloren'
  };

  const props = {
    'Status': { select: { name: statusMap[status] || 'Neu' } }
  };
  if (demoUrl) props['Demo-Website'] = { url: demoUrl };

  try {
    await axios.patch(`https://api.notion.com/v1/pages/${notionPageId}`,
      { properties: props },
      { headers: notionHeaders() }
    );
  } catch (e) {
    console.error('Notion Update Fehler:', e.response?.data?.message || e.message);
  }
}

module.exports = { syncLeadToNotion, updateNotionStatus };

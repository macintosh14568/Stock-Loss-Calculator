// Content script to extract data from Robinhood DOM
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractData') {
    try {
      const data = extractRobinhoodData();
      sendResponse({ success: true, data: data });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  } else if (request.action === 'populateQuantity') {
    try {
      const quantityInput = document.querySelector('input[name="quantity"]');
      if (quantityInput) {
        quantityInput.value = request.quantity;
        quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
        quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Quantity input not found' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  } else if (request.action === 'scanPositions') {
    try {
      const positions = scanPositions();
      sendResponse({ success: true, positions: positions });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  return true; // Keep message channel open for async response
});

function extractRobinhoodData() {
  function parseCurrency(str) {
    if (!str) return null;
    return parseFloat(str.replace(/[$,]/g, ''));
  }

  let currentPrice = null;
  let avgCost = null;
  let numShares = null;

  // Look for current price in aria-label attribute
  const priceElements = document.querySelectorAll('span[aria-label]');
  for (const elem of priceElements) {
    const ariaLabel = elem.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.startsWith('$')) {
      const price = parseCurrency(ariaLabel);
      if (price && price > 0 && !currentPrice) {
        currentPrice = price;
        break;
      }
    }
  }

  // Look for "Your average cost" text and get the next h2 element
  const avgCostDivs = document.querySelectorAll('div.caption-text');
  for (const div of avgCostDivs) {
    if (div.textContent.trim().toLowerCase().includes('average cost')) {
      const nextH2 = div.nextElementSibling;
      if (nextH2 && nextH2.tagName === 'H2') {
        avgCost = parseCurrency(nextH2.textContent);
        break;
      }
    }
  }

  // Look for "Shares" in table rows
  const tableRows = document.querySelectorAll('tbody tr');
  for (const row of tableRows) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 3) {
      const firstCell = cells[0].textContent.trim().toLowerCase();
      if (firstCell === 'shares') {
        const sharesValue = cells[2].textContent.trim();
        numShares = parseFloat(sharesValue.replace(/[^\d.]/g, ''));
        break;
      }
    }
  }

  // Validate we found all required data
  if (!currentPrice || !avgCost || !numShares) {
    throw new Error(
      `Could not extract all required data. Found: Price=${currentPrice}, Avg Cost=${avgCost}, Shares=${numShares}. ` +
      `Please make sure you're on a Robinhood stock position page.`
    );
  }

  return {
    currentPrice: currentPrice,
    avgCost: avgCost,
    numShares: numShares
  };
}

function scanPositions() {
  const positions = [];
  const positionCells = document.querySelectorAll('div[data-testid="PositionCell"]');
  
  positionCells.forEach(cell => {
    try {
      // Extract ticker symbol
      const tickerElem = cell.querySelector('span.css-1ezzyzy');
      if (!tickerElem) return;
      const ticker = tickerElem.textContent.trim();
      
      // Extract shares count
      const sharesElem = cell.querySelector('span.css-14ulni3');
      let shares = 0;
      if (sharesElem) {
        const sharesText = sharesElem.textContent.trim();
        const sharesMatch = sharesText.match(/[\d,]+/);
        if (sharesMatch) {
          shares = parseFloat(sharesMatch[0].replace(/,/g, ''));
        }
      }
      
      // Extract percent change (look for the percentage with + or -)
      const percentElems = cell.querySelectorAll('span');
      let percentChange = null;
      
      for (const elem of percentElems) {
        const text = elem.textContent.trim();
        if (text.match(/^[+\-][\d,]+\.[\d]+%$/)) {
          percentChange = text.replace(/[+%]/g, '');
          break;
        }
      }
      
      if (ticker && percentChange !== null) {
        positions.push({
          ticker: ticker,
          shares: shares,
          percentChange: percentChange
        });
      }
    } catch (err) {
      console.error('Error parsing position cell:', err);
    }
  });
  
  return positions;
}
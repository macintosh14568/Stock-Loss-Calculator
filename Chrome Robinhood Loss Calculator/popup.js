// Popup script for the extension
document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`${tabName}-tab`).classList.add('active');
    });
  });

  // Calculator Tab
  const targetLossInput = document.getElementById('targetLoss');
  const calculateBtn = document.getElementById('calculate');
  const resultsDiv = document.getElementById('results');
  const errorDiv = document.getElementById('error');

  // Load saved target loss percentage
  chrome.storage.sync.get(['targetLoss'], (result) => {
    if (result.targetLoss) {
      targetLossInput.value = result.targetLoss;
    }
  });

  // Check if we should auto-calculate (navigated from monitor tab)
  chrome.storage.local.get(['autoCalculate', 'targetLossForCalc'], (result) => {
    if (result.autoCalculate) {
      // Clear the flag
      chrome.storage.local.remove(['autoCalculate', 'targetLossForCalc']);
      
      // Set the target loss if provided
      if (result.targetLossForCalc) {
        targetLossInput.value = result.targetLossForCalc;
        chrome.storage.sync.set({ targetLoss: result.targetLossForCalc });
      }
      
      // Wait a bit for the page to load, then trigger calculation
      setTimeout(() => {
        calculateBtn.click();
      }, 1500);
    }
  });

  // Save target loss percentage when changed
  targetLossInput.addEventListener('change', () => {
    const value = parseFloat(targetLossInput.value);
    if (!isNaN(value)) {
      chrome.storage.sync.set({ targetLoss: value });
    }
  });

  calculateBtn.addEventListener('click', async () => {
    hideError();
    hideResults();
    
    const targetLoss = parseFloat(targetLossInput.value);
    
    if (isNaN(targetLoss) || targetLoss < 0 || targetLoss > 100) {
      showError('Please enter a valid target loss percentage (0-100)');
      return;
    }

    calculateBtn.disabled = true;
    calculateBtn.textContent = 'Calculating...';

    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url || !tab.url.includes('robinhood.com')) {
        showError('Please navigate to a Robinhood position page first');
        return;
      }

      // Send message to content script to extract data
      chrome.tabs.sendMessage(tab.id, { action: 'extractData' }, (response) => {
        if (chrome.runtime.lastError) {
          showError('Could not connect to page. Please refresh the Robinhood page and try again.');
          return;
        }

        if (!response.success) {
          showError(response.error || 'Failed to extract data from page');
          return;
        }

        const { currentPrice, avgCost, numShares } = response.data;
        
        // Calculate results
        const results = calculateSharesToBuy(currentPrice, avgCost, numShares, targetLoss);
        
        // Display results
        displayResults(results);
      });
    } catch (error) {
      showError(error.message);
    } finally {
      calculateBtn.disabled = false;
      calculateBtn.textContent = 'Calculate Shares Needed';
    }
  });

  function calculateSharesToBuy(currentPrice, avgCost, currentShares, targetLossPercent) {
    // Current loss calculation
    const currentValue = currentPrice * currentShares;
    const currentCost = avgCost * currentShares;
    const currentLoss = currentValue - currentCost;
    const currentLossPercent = (currentLoss / currentCost) * 100;

    // To achieve target loss percentage:
    // (currentPrice * totalShares - avgCost * currentShares - currentPrice * sharesToBuy) / 
    // (avgCost * currentShares + currentPrice * sharesToBuy) = -targetLossPercent / 100
    
    // Simplified formula:
    // newAvgCost = (currentCost + currentPrice * sharesToBuy) / (currentShares + sharesToBuy)
    // targetLoss = (currentPrice - newAvgCost) / newAvgCost
    // Solving for sharesToBuy:
    
    const targetLossRatio = -targetLossPercent / 100; // Negative because it's a loss
    
    // Formula derived:
    // sharesToBuy = (currentCost * (1 + targetLossRatio) - currentPrice * currentShares) / 
    //               (currentPrice * (1 + targetLossRatio) - currentPrice)
    
    // Simpler approach: solve for new average cost needed
    const targetAvgCost = currentPrice / (1 + targetLossRatio);
    
    // newAvgCost = (currentCost + currentPrice * x) / (currentShares + x) = targetAvgCost
    // Solving for x (sharesToBuy):
    // currentCost + currentPrice * x = targetAvgCost * (currentShares + x)
    // currentCost + currentPrice * x = targetAvgCost * currentShares + targetAvgCost * x
    // currentPrice * x - targetAvgCost * x = targetAvgCost * currentShares - currentCost
    // x * (currentPrice - targetAvgCost) = targetAvgCost * currentShares - currentCost
    
    const sharesToBuy = (targetAvgCost * currentShares - currentCost) / (currentPrice - targetAvgCost);
    
    // Calculate new values
    const newTotalShares = currentShares + Math.ceil(sharesToBuy);
    const newTotalCost = currentCost + currentPrice * Math.ceil(sharesToBuy);
    const newAvgCost = newTotalCost / newTotalShares;
    const newValue = currentPrice * newTotalShares;
    const newLoss = newValue - newTotalCost;
    const newLossPercent = (newLoss / newTotalCost) * 100;

    return {
      currentPrice,
      avgCost,
      currentShares,
      currentLoss,
      currentLossPercent,
      sharesToBuy: Math.ceil(sharesToBuy), // Round up
      newTotalShares,
      newAvgCost,
      newLossPercent
    };
  }

  function displayResults(results) {
    document.getElementById('currentPrice').textContent = `${results.currentPrice.toFixed(2)}`;
    document.getElementById('avgCost').textContent = `${results.avgCost.toFixed(2)}`;
    document.getElementById('currentShares').textContent = results.currentShares.toFixed(2);
    document.getElementById('currentLoss').textContent = `${results.currentLoss.toFixed(2)}`;
    document.getElementById('currentLossPercent').textContent = `${results.currentLossPercent.toFixed(2)}%`;
    
    const sharesToBuyElem = document.getElementById('sharesToBuy');
    if (results.sharesToBuy <= 0) {
      sharesToBuyElem.textContent = 'Already at or below target!';
      sharesToBuyElem.classList.remove('highlight');
      sharesToBuyElem.classList.add('positive');
      sharesToBuyElem.style.cursor = 'default';
      sharesToBuyElem.style.textDecoration = 'none';
      sharesToBuyElem.onclick = null;
    } else {
      sharesToBuyElem.textContent = results.sharesToBuy.toString();
      sharesToBuyElem.classList.add('highlight');
      sharesToBuyElem.classList.remove('positive');
      
      // Make it clickable to populate the quantity input on Robinhood
      sharesToBuyElem.onclick = async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          chrome.tabs.sendMessage(tab.id, { 
            action: 'populateQuantity', 
            quantity: results.sharesToBuy 
          }, (response) => {
            if (chrome.runtime.lastError) {
              alert('Could not populate quantity. Make sure you\'re on the Robinhood page.');
            } else if (response && response.success) {
              // Visual feedback
              sharesToBuyElem.textContent = '✓ Filled!';
              setTimeout(() => {
                sharesToBuyElem.textContent = results.sharesToBuy.toString();
              }, 1500);
            }
          });
        } catch (error) {
          alert('Error: ' + error.message);
        }
      };
    }
    
    document.getElementById('newTotalShares').textContent = results.newTotalShares.toFixed(2);
    document.getElementById('newAvgCost').textContent = `${results.newAvgCost.toFixed(2)}`;
    
    const newLossPercentElem = document.getElementById('newLossPercent');
    newLossPercentElem.textContent = `${results.newLossPercent.toFixed(2)}%`;
    newLossPercentElem.classList.toggle('negative', results.newLossPercent < 0);
    newLossPercentElem.classList.toggle('positive', results.newLossPercent >= 0);

    resultsDiv.classList.add('visible');
  }

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.add('visible');
  }

  function hideError() {
    errorDiv.classList.remove('visible');
  }

  function hideResults() {
    resultsDiv.classList.remove('visible');
  }

  // Monitor Tab
  const monitorTargetLossInput = document.getElementById('monitorTargetLoss');
  const scanPositionsBtn = document.getElementById('scanPositions');
  const positionList = document.getElementById('positionList');
  const monitorError = document.getElementById('monitorError');

  // Load saved monitor target loss
  chrome.storage.sync.get(['monitorTargetLoss'], (result) => {
    if (result.monitorTargetLoss) {
      monitorTargetLossInput.value = result.monitorTargetLoss;
    }
  });

  // Save monitor target loss when changed
  monitorTargetLossInput.addEventListener('change', () => {
    const value = parseFloat(monitorTargetLossInput.value);
    if (!isNaN(value)) {
      chrome.storage.sync.set({ monitorTargetLoss: value });
    }
  });

  scanPositionsBtn.addEventListener('click', async () => {
    hideMonitorError();
    
    const targetLoss = parseFloat(monitorTargetLossInput.value);
    
    if (isNaN(targetLoss) || targetLoss < 0 || targetLoss > 100) {
      showMonitorError('Please enter a valid target loss percentage (0-100)');
      return;
    }

    scanPositionsBtn.disabled = true;
    scanPositionsBtn.textContent = 'Scanning...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url || !tab.url.includes('robinhood.com')) {
        showMonitorError('Please navigate to your Robinhood portfolio page first');
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'scanPositions' }, (response) => {
        if (chrome.runtime.lastError) {
          showMonitorError('Could not connect to page. Please refresh and try again.');
          return;
        }

        if (!response.success) {
          showMonitorError(response.error || 'Failed to scan positions');
          return;
        }

        displayPositions(response.positions, targetLoss);
      });
    } catch (error) {
      showMonitorError(error.message);
    } finally {
      scanPositionsBtn.disabled = false;
      scanPositionsBtn.textContent = 'Scan Positions';
    }
  });

  function displayPositions(positions, targetLoss) {
    if (positions.length === 0) {
      positionList.innerHTML = '<div class="no-positions">✅ No positions found exceeding your target loss!</div>';
      return;
    }

    // Filter positions exceeding target loss
    const filtered = positions.filter(p => {
      const lossPercent = parseFloat(p.percentChange);
      return lossPercent < -targetLoss;
    });

    if (filtered.length === 0) {
      positionList.innerHTML = '<div class="no-positions">✅ No positions found exceeding your target loss!</div>';
      return;
    }

    positionList.innerHTML = filtered.map(pos => `
      <div class="position-item" data-ticker="${pos.ticker}">
        <div class="position-header">
          <span class="position-ticker">${pos.ticker}</span>
          <span class="position-loss">${pos.percentChange}%</span>
        </div>
        <div class="position-shares">${pos.shares} Shares</div>
      </div>
    `).join('');

    // Add click handlers to navigate to position
    document.querySelectorAll('.position-item').forEach(item => {
      item.addEventListener('click', async () => {
        const ticker = item.getAttribute('data-ticker');
        const targetLoss = parseFloat(monitorTargetLossInput.value);
        
        // Save that we're navigating from monitor
        chrome.storage.local.set({ 
          autoCalculate: true, 
          targetLossForCalc: targetLoss 
        });
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.update(tab.id, { url: `https://robinhood.com/stocks/${ticker}` });
        
        // Close the popup
        window.close();
      });
    });
  }

  function showMonitorError(message) {
    monitorError.textContent = message;
    monitorError.classList.add('visible');
  }

  function hideMonitorError() {
    monitorError.classList.remove('visible');
  }
});
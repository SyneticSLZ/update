// Base API URL
const API_BASE_URL = 'https://update-g6ic.onrender.com0/api';

// App state
const app = {
    competitorData: null,
    isLoading: true,
    error: null,
    charts: {},
    marketPageState: { device: { current: 1, size: 10 }, drug: { current: 1, size: 10 } },
    // Initialize application
    async init() {
        // Handle dark mode toggle
        document.getElementById('dark-mode-toggle').addEventListener('click', this.toggleDarkMode);
        
        // Set up tab navigation
        this.setupTabNavigation();
        
        // Set up modal close buttons
        this.setupModals();
        
        // Get competitor name from URL
        const params = new URLSearchParams(window.location.search);
        const competitorName = params.get('name');
        
        if (!competitorName) {
            this.showError('No competitor specified. Please return to the main page and select a competitor.');
            return;
        }
        
        // Fetch competitor data
        await this.fetchCompetitorData(competitorName);
        
        // Set up export functionality
        document.getElementById('export-report').addEventListener('click', () => this.exportReport());
    },
    
    // Toggle dark mode
    toggleDarkMode() {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('darkMode', document.documentElement.classList.contains('dark'));
    },
    
    // Set up tab navigation
    setupTabNavigation() {
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');
                
                // Hide all tab contents
                document.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                
                // Show selected tab content
                document.getElementById(tabId).classList.add('active');
                
                // Update button styles
                document.querySelectorAll('.tab-button').forEach(btn => {
                    btn.classList.remove('text-marcomm-orange', 'border-marcomm-orange');
                    btn.classList.add('text-gray-500', 'border-transparent');
                });
                
                button.classList.add('text-marcomm-orange', 'border-marcomm-orange');
                button.classList.remove('text-gray-500', 'border-transparent');
            });
        });
    },
    
    // Set up modals
    setupModals() {
        // Trial detail modal
        document.getElementById('trial-modal-close').addEventListener('click', () => {
            document.getElementById('trial-detail-modal').classList.add('hidden');
        });
        
        // Patent detail modal
        document.getElementById('patent-modal-close').addEventListener('click', () => {
            document.getElementById('patent-detail-modal').classList.add('hidden');
        });
        
        // Close modals on background click
        document.getElementById('trial-detail-modal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('trial-detail-modal')) {
                document.getElementById('trial-detail-modal').classList.add('hidden');
            }
        });
        
        document.getElementById('patent-detail-modal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('patent-detail-modal')) {
                document.getElementById('patent-detail-modal').classList.add('hidden');
            }
        });
        
        // Close modals on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.getElementById('trial-detail-modal').classList.add('hidden');
                document.getElementById('patent-detail-modal').classList.add('hidden');
            }
        });
    },
    
    // Show loading state
    showLoading() {
        this.isLoading = true;
        document.getElementById('loading-indicator').classList.remove('hidden');
        document.getElementById('error-message').classList.add('hidden');
        document.getElementById('competitor-header').classList.add('hidden');
        document.getElementById('summary-metrics').classList.add('hidden');
        document.getElementById('tab-navigation').classList.add('hidden');
    },
    
    // Hide loading state
    hideLoading() {
        this.isLoading = false;
        document.getElementById('loading-indicator').classList.add('hidden');
        document.getElementById('competitor-header').classList.remove('hidden');
        document.getElementById('summary-metrics').classList.remove('hidden');
        document.getElementById('tab-navigation').classList.remove('hidden');
    },
    
    // Show error message
    showError(message) {
        this.isLoading = false;
        this.error = message;
        document.getElementById('loading-indicator').classList.add('hidden');
        document.getElementById('error-message').classList.remove('hidden');
        document.getElementById('error-text').textContent = message || 'Error loading competitor data. Please try again later.';
    },
    
    // Fetch competitor data from API
    async fetchCompetitorData(competitorName) {
        try {
            this.showLoading();
            const [competitorResponse, marketResponse] = await Promise.all([
                fetch(`${API_BASE_URL}/competitors/${encodeURIComponent(competitorName)}`),
                fetch(`${API_BASE_URL}/market/company/${encodeURIComponent(competitorName)}`)
            ]);

            if (!competitorResponse.ok || !marketResponse.ok) {
                console.log(competitorResponse, marketResponse)
                throw new Error(`Server error: ${competitorResponse.status}, ${marketResponse.status}`);
            }

            const competitorData = await competitorResponse.json();
            const marketData = await marketResponse.json();
            this.competitorData = { ...competitorData, marketData: marketData.data };

            this.renderCompetitorData();
            this.hideLoading();
            this.setupRefreshButtons();
        } catch (error) {
            console.error('Error fetching competitor data:', error);
            this.showError(error.message);
            
            // Add retry button functionality
            document.getElementById('retry-button').addEventListener('click', () => {
                this.fetchCompetitorData(competitorName);
            });
        }
    },
    
    // Set up refresh buttons for each tab
    setupRefreshButtons() {
        document.getElementById('refresh-fda').addEventListener('click', () => this.refreshFdaData());
        document.getElementById('refresh-trials').addEventListener('click', () => this.refreshTrialsData());
        document.getElementById('refresh-patents').addEventListener('click', () => this.refreshPatentsData());
        document.getElementById('refresh-market').addEventListener('click', () => this.refreshMarketData());
        document.getElementById('refresh-sec')?.addEventListener('click', () => this.refreshSecData());
    },
    
    // Refresh FDA data tab
    async refreshFdaData() {
        const fdaLoading = document.getElementById('fda-loading');
        const fdaError = document.getElementById('fda-error');
        const fdaContent = document.getElementById('fda-content');
        
        fdaLoading.classList.remove('hidden');
        fdaError.classList.add('hidden');
        fdaContent.classList.add('hidden');
        
        try {
            const response = await fetch(`${API_BASE_URL}/competitors/${encodeURIComponent(this.competitorData.name)}`);
            
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            
            const data = await response.json();
            this.competitorData = data;
            
            // Re-render FDA data
            this.renderFdaData();
            
            fdaLoading.classList.add('hidden');
            fdaContent.classList.remove('hidden');
        } catch (error) {
            console.error('Error refreshing FDA data:', error);
            fdaLoading.classList.add('hidden');
            fdaError.classList.remove('hidden');
        }
    },
    
    // Refresh Clinical Trials data tab
    async refreshTrialsData() {
        const trialsLoading = document.getElementById('trials-loading');
        const trialsError = document.getElementById('trials-error');
        const trialsContent = document.getElementById('trials-content');
        
        trialsLoading.classList.remove('hidden');
        trialsError.classList.add('hidden');
        trialsContent.classList.add('hidden');
        
        try {
            const response = await fetch(`${API_BASE_URL}/competitors/${encodeURIComponent(this.competitorData.name)}`);
            
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            
            const data = await response.json();
            this.competitorData = data;
            
            // Re-render Trials data
            this.renderTrialsData();
            
            trialsLoading.classList.add('hidden');
            trialsContent.classList.remove('hidden');
        } catch (error) {
            console.error('Error refreshing trials data:', error);
            trialsLoading.classList.add('hidden');
            trialsError.classList.remove('hidden');
        }
    },
    
    // Refresh Patents data tab
    async refreshPatentsData() {
        const patentsLoading = document.getElementById('patents-loading');
        const patentsError = document.getElementById('patents-error');
        const patentsContent = document.getElementById('patent-ip');
        
        patentsLoading.classList.remove('hidden');
        patentsError.classList.add('hidden');
        patentsContent.classList.add('hidden');
        
        try {
            const response = await fetch(`${API_BASE_URL}/competitors/${encodeURIComponent(this.competitorData.name)}`);
            
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('patents :' ,data)
            this.competitorData = data;
            
            // Re-render Patents data
            this.renderPatentsData();
            
            patentsLoading.classList.add('hidden');
            patentsContent.classList.remove('hidden');
        } catch (error) {
            console.error('Error refreshing patents data:', error);
            patentsLoading.classList.add('hidden');
            patentsError.classList.remove('hidden');
        }
    },
    
    // Refresh Market data tab
    async refreshMarketData() {
        const marketLoading = document.getElementById('market-loading');
        const marketError = document.getElementById('market-error');
        const marketContent = document.getElementById('market-content');
        
        marketLoading.classList.remove('hidden');
        marketError.classList.add('hidden');
        marketContent.classList.add('hidden');
        
        try {
            const response = await fetch(`${API_BASE_URL}/competitors/${encodeURIComponent(this.competitorData.name)}`);
            
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            
            const data = await response.json();
            this.competitorData = data;
            
            // Re-render Market data
            this.renderMarketData();
            
            marketLoading.classList.add('hidden');
            marketContent.classList.remove('hidden');
        } catch (error) {
            console.error('Error refreshing market data:', error);
            marketLoading.classList.add('hidden');
            marketError.classList.remove('hidden');
        }
    },
    
    // Refresh SEC data tab
    async refreshSecData() {
        const secLoading = document.getElementById('sec-loading');
        const secError = document.getElementById('sec-error');
        const secContent = document.getElementById('sec-content');
        
        if (!secLoading || !secError || !secContent) return;
        
        secLoading.classList.remove('hidden');
        secError.classList.add('hidden');
        secContent.classList.add('hidden');
        
        try {
            const response = await fetch(`${API_BASE_URL}/competitors/${encodeURIComponent(this.competitorData.name)}`);
            
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            
            const data = await response.json();
            this.competitorData = data;
            
            // Re-render SEC data
            this.renderSecData();
            
            secLoading.classList.add('hidden');
            secContent.classList.remove('hidden');
        } catch (error) {
            console.error('Error refreshing SEC data:', error);
            secLoading.classList.add('hidden');
            secError.classList.remove('hidden');
        }
    },
    
    // Function to log data for debugging
    logData(label, data) {
        console.group(`Debug: ${label}`);
        console.log(data);
        try {
            if (typeof data === 'object' && data !== null) {
                // Log all top-level keys
                console.log('Available keys:', Object.keys(data));
                
                // If it's not too large, log as JSON to see the full structure
                const jsonStr = JSON.stringify(data, null, 2);
                if (jsonStr.length < 10000) {
                    console.log('Data as JSON:', jsonStr);
                } else {
                    console.log('Data too large to log as JSON');
                }
            }
        } catch (e) {
            console.error('Error logging data:', e);
        }
        console.groupEnd();
    },
    
    // Render all competitor data
    renderCompetitorData() {
        // Log all received data for debugging
        this.logData('Complete Competitor Data', this.competitorData);
        
        // Check nested objects and identify undefined/missing data
        if (this.competitorData.fdaApprovals) {
            this.logData('FDA Approvals', this.competitorData.fdaApprovals);
        } else {
            console.warn('FDA Approvals data is missing');
        }
        
        if (this.competitorData.clinicalTrials) {
            this.logData('Clinical Trials', this.competitorData.clinicalTrials);
        } else {
            console.warn('Clinical Trials data is missing');
        }
        
        if (this.competitorData.patents) {
            this.logData('Patents', this.competitorData.patents);
        } else {
            console.warn('Patents data is missing');
        }
        
        if (this.competitorData.summary) {
            this.logData('Summary Data', this.competitorData.summary);
        } else {
            console.warn('Summary data is missing');
        }
        
        if (this.competitorData.cmsPartB) {
            this.logData('CMS Part B Data', this.competitorData.cmsPartB);
        }
        
        if (this.competitorData.cmsPartD) {
            this.logData('CMS Part D Data', this.competitorData.cmsPartD);
        }
        
        if (this.competitorData.orangeBook) {
            this.logData('Orange Book Data', this.competitorData.orangeBook);
        }
        
        if (this.competitorData.secFilings) {
            this.logData('SEC Filings', this.competitorData.secFilings);
        }
        
        // Set page title
        document.title = `${this.competitorData.name} - Competitor Details - Marcomm Platform`;
        
        // Render header content
        this.renderHeaderContent();
        
        // Render summary cards
        this.renderSummaryCards();
        
        // Render each tab content
        this.renderFdaData();
        this.renderTrialsData();
        this.renderPatentsData();
        this.renderMarketData();
        
        // Check if SEC filings tab should be shown
        if (this.competitorData.cik || (this.competitorData.summary && this.competitorData.summary.cik)) {
            document.getElementById('sec-filings-tab').classList.remove('hidden');
            this.renderSecData();
        }
    },
    
    // Render competitor header
    renderHeaderContent() {
        // Set competitor name
        document.getElementById('competitor-name').textContent = this.competitorData.name;
        
        // Set competitor treatment
        document.getElementById('competitor-treatment').textContent = this.competitorData.treatment;
        
        // Set competitor type badge
        const typeBadge = document.getElementById('competitor-type-badge');
        typeBadge.textContent = this.competitorData.type.charAt(0).toUpperCase() + this.competitorData.type.slice(1);
        
        // Set appropriate icon based on type
        const iconElement = document.getElementById('competitor-icon').querySelector('i');
        
        switch (this.competitorData.type) {
            case 'device':
                iconElement.className = 'fas fa-microchip text-2xl';
                typeBadge.className = 'px-3 py-1 bg-marcomm-blue/10 text-marcomm-blue dark:bg-marcomm-blue/20 dark:text-marcomm-blue-dark rounded-full text-sm mr-2';
                break;
            case 'drug':
                iconElement.className = 'fas fa-pills text-2xl';
                typeBadge.className = 'px-3 py-1 bg-purple-500/10 text-purple-500 dark:bg-purple-500/20 dark:text-purple-400 rounded-full text-sm mr-2';
                break;
            case 'early-stage':
                iconElement.className = 'fas fa-flask text-2xl';
                typeBadge.className = 'px-3 py-1 bg-marcomm-green/10 text-marcomm-green dark:bg-marcomm-green/20 dark:text-marcomm-green rounded-full text-sm mr-2';
                break;
            default:
                iconElement.className = 'fas fa-building text-2xl';
        }
    },
    
    // Render summary cards
    renderSummaryCards() {
        // Get summary data
        const summary = this.competitorData.summary || {};
        
        // Market Metrics Card

        
        // Regulatory Card
        // Get FDA data and trials data
        const fdaData = this.competitorData.fdaApprovals || { combinedResults: [] };
        const trialData = this.competitorData.clinicalTrials || [];
        
        // Set FDA status
        document.getElementById('fda-status').textContent = 
            (fdaData.combinedResults && fdaData.combinedResults.length > 0) ? 
            'Data Available' : 'No Data Found';
        
        // Set latest approval (use the most recent FDA item if available)
        if (fdaData.combinedResults && fdaData.combinedResults.length > 0) {
            const mostRecent = fdaData.combinedResults.reduce((latest, current) => {
                if (!latest.date) return current;
                if (!current.date) return latest;
                
                // Try to parse dates and compare (handle various date formats)
                try {
                    const latestDate = new Date(latest.date);
                    const currentDate = new Date(current.date);
                    
                    if (!isNaN(latestDate.getTime()) && !isNaN(currentDate.getTime())) {
                        return currentDate > latestDate ? current : latest;
                    }
                } catch (e) {
                    // If date parsing fails, just use string comparison
                }
                
                return latest;
            }, fdaData.combinedResults[0]);
            
            document.getElementById('latest-approval').textContent = 
                mostRecent.date || 'Unknown Date';
        } else {
            document.getElementById('latest-approval').textContent = 'None Found';
        }
        
        // Set active trials count
        const activeTrials = trialData.filter(t => 
            ['Recruiting', 'Active, not recruiting', 'Not yet recruiting'].includes(t.status)
        ).length;
        
        document.getElementById('active-trials').textContent = 
            `${trialData.length}`;
        
        // Set recalls count (from FDA data if available)
        let recallCount = 0;
        
        if (fdaData.endpoints && fdaData.endpoints.enforcement) {
            recallCount = fdaData.endpoints.enforcement.data ? 
                fdaData.endpoints.enforcement.data.length : 0;
        }
        
        document.getElementById('recalls').textContent = recallCount || 'None Found';
        
        // IP & Legal Card
        // Get patents data and SEC filings
        const patentData = this.competitorData.patents || [];
        const secFilings = this.competitorData.secFilings || [];
        
        // Set patent count
        document.getElementById('patent-count').textContent = patentData.length || '0';
        
        // Set recent filings
        document.getElementById('recent-filings').textContent = 
            patentData.length > 0 ? 
            `${Math.min(3, patentData.length)} recent` : 
            'None found';
        
        // Set patent expiry (from Orange Book if available for drugs)
        if (this.competitorData.type === 'drug' && this.competitorData.orangeBook && this.competitorData.orangeBook.summary) {
            document.getElementById('patent-expiry').textContent = 
                this.competitorData.orangeBook.summary.patentEnd || 'Unknown';
        } else {
            document.getElementById('patent-expiry').textContent = 'N/A';
        }
        
        // Set SEC status
        document.getElementById('sec-status').textContent = 
            (this.competitorData.cik || (summary && summary.cik)) ? 
            'Public Company' : 
            'Private / Unknown';
    },
    
    // Render FDA data tab
    renderFdaData() {
        try {
            // Initialize page state with safe defaults
            window.pageState = {
                fda: { current: 1, size: 10 }
            };
    
            // Show loading states
            document.getElementById('fda-summary-content')?.classList.add('animate-pulse');
            
            // Get FDA data with safe defaults
            const fdaData = this.competitorData.fdaApprovals || { 
                combinedResults: [], 
                endpoints: {}
            };
            this.logData('FDA Data for Rendering', fdaData);
            
            // Store data globally for modal access
            window.globalFDAData = {
                results: fdaData.combinedResults || []
            };
    
            // Setup modal if not already done
            this.setupFdaModal();
            
            // Update overview metrics
            this.updateFdaOverviewStats(fdaData);
            
            // Initialize charts if available
            if (fdaData.combinedResults && fdaData.combinedResults.length > 0) {
                this.initializeFdaCharts(fdaData);
            }
            
            // Populate FDA table with grouped entries
            this.populateFdaTable(fdaData);
            
            // Set up pagination and search
            this.setupFdaPaginationHandlers();
            this.setupFdaTableSearch();
            
        } catch (error) {
            console.error('Error rendering FDA dashboard:', error);
            this.showFdaErrorState(error);
        } finally {
            // Hide loading states
            document.getElementById('fda-summary-content')?.classList.remove('animate-pulse');
        }
    },
    
    updateFdaOverviewStats(data) {
        const fdaSummaryContent = document.getElementById('fda-summary-content');
        if (!fdaSummaryContent) return;
        
        // Count successful endpoints
        const successfulEndpoints = Object.entries(data.endpoints || {})
            .filter(([_, endpointData]) => endpointData.status === 'success')
            .map(([name, _]) => name);
        
        const hasData = data.combinedResults && data.combinedResults.length > 0;
        
        if (hasData) {
            // Create an enhanced metrics grid
            fdaSummaryContent.innerHTML = `
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                        <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Records</h3>
                        <p class="text-2xl font-light mt-2 text-gray-900 dark:text-white">${data.combinedResults.length}</p>
                    </div>
                    
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                        <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Data Sources</h3>
                        <p class="text-2xl font-light mt-2 text-gray-900 dark:text-white">${successfulEndpoints.length}</p>
                    </div>
                    
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                        <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Recent Updates</h3>
                        <p class="text-2xl font-light mt-2 text-gray-900 dark:text-white">${this.getRecentFdaCount(data.combinedResults)}</p>
                    </div>
                    
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                        <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Product Type</h3>
                        <p class="text-2xl font-light mt-2 text-gray-900 dark:text-white">${this.competitorData.type === 'device' ? 'Medical Device' : 'Pharmaceutical'}</p>
                    </div>
                </div>
                
                <div class="mt-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                    <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Available FDA Data Sources</h3>
                    <div class="flex flex-wrap gap-2">
                        ${successfulEndpoints.map(endpoint => `
                            <span class="px-2 py-1 text-xs rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                                ${this.formatEndpointName(endpoint)}
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        } else {
            fdaSummaryContent.innerHTML = `
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                    <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">No FDA data found</h3>
                    <p class="text-gray-600 dark:text-gray-400 mb-4">No FDA data found for ${this.competitorData.name}. This may be because:</p>
                    <ul class="list-disc pl-6 text-gray-600 dark:text-gray-400 space-y-2">
                        <li>The product is not yet regulated by the FDA</li>
                        <li>The product is in early development stages</li>
                        <li>The product might be registered under a different name</li>
                        <li>The product may be exempt from certain FDA regulations</li>
                    </ul>
                </div>
            `;
        }
    },
    
    getRecentFdaCount(items) {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        return items.filter(item => {
            // Handle various date formats and fallbacks
            if (!item.date) return false;
            
            try {
                const itemDate = new Date(item.date);
                return !isNaN(itemDate) && itemDate >= oneYearAgo;
            } catch(e) {
                return false;
            }
        }).length;
    },
    
    formatEndpointName(endpoint) {
        // Convert camelCase or snake_case to readable format
        return endpoint
            .replace(/([A-Z])/g, ' $1') // Add space before capital letters
            .replace(/_/g, ' ') // Replace underscores with spaces
            .replace(/^\w/, c => c.toUpperCase()); // Capitalize first letter
    },
    
    initializeFdaCharts(data) {
        // Destroy any existing charts to prevent duplicates
        if (window.activeCharts) {
            window.activeCharts.forEach(chart => {
                if (chart) {
                    chart.destroy();
                }
            });
        }
        window.activeCharts = [];
        
        // Only proceed if we have data
        if (!data.combinedResults || data.combinedResults.length === 0) return;
        
        // 1. Timeline Chart - shows approvals over time
        const timelineCtx = document.getElementById('fda-timeline-chart');
        if (timelineCtx) {
            const timelineData = this.processTimelineData(data.combinedResults);
            
            const timelineChart = new Chart(timelineCtx, {
                type: 'line',
                data: {
                    labels: timelineData.labels,
                    datasets: [{
                        label: 'FDA Records',
                        data: timelineData.data,
                        borderColor: '#10B981',
                        backgroundColor: '#10B98133',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'top',
                        },
                        tooltip: {
                            callbacks: {
                                title: (context) => {
                                    return context[0].label;
                                },
                                label: (context) => {
                                    return `Records: ${context.raw}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Timeline'
                            }
                        },
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Records'
                            }
                        }
                    }
                }
            });
            
            window.activeCharts.push(timelineChart);
        }
        


        // 2. Source Distribution Chart
        const sourceCtx = document.getElementById('fda-source-chart');
        if (sourceCtx) {
            const sourceData = this.processSourceData(data.combinedResults);
            
            // Ensure the canvas has proper sizing attributes
            sourceCtx.style.maxWidth = '100%';
            sourceCtx.style.height = 'auto';
            
            const sourceChart = new Chart(sourceCtx, {
                type: 'pie',
                data: {
                    labels: sourceData.labels,
                    datasets: [{
                        data: sourceData.data,
                        backgroundColor: sourceData.colors
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true, // Ensure aspect ratio is maintained
                    aspectRatio: 1, // Square aspect ratio (adjust as needed)
                    plugins: {
                        legend: {
                            position: 'right',
                            maxWidth: 150, // Limit legend width to prevent overflow
                            labels: {
                                boxWidth: 20, // Control legend item size
                                padding: 10,
                                font: {
                                    size: 12 // Consistent font size
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const label = context.label;
                                    const value = context.raw;
                                    const total = sourceData.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    },
                    layout: {
                        padding: 10 // Add internal padding to prevent cutoff
                    }
                }
            });
            
            window.activeCharts.push(sourceChart);
        }
    },
    
    processTimelineData(records) {
        // Group records by year
        const yearlyData = records.reduce((acc, record) => {
            let year = 'Unknown';
            
            // Try to extract year from date
            if (record.date) {
                try {
                    const date = new Date(record.date);
                    if (!isNaN(date)) {
                        year = date.getFullYear().toString();
                    }
                } catch (e) {
                    // Use the fallback 'Unknown'
                }
            }
            
            acc[year] = (acc[year] || 0) + 1;
            return acc;
        }, {});
        
        // Sort years chronologically, keeping 'Unknown' at the end
        const sortedYears = Object.keys(yearlyData)
            .filter(year => year !== 'Unknown')
            .sort()
            .concat(yearlyData['Unknown'] ? ['Unknown'] : []);
        
        return {
            labels: sortedYears,
            data: sortedYears.map(year => yearlyData[year])
        };
    },
    
    processSourceData(records) {
        // Group records by source
        const sourceCount = records.reduce((acc, record) => {
            const source = record.source || 'Unknown';
            acc[source] = (acc[source] || 0) + 1;
            return acc;
        }, {});
        
        // Sort sources by count (descending)
        const sortedSources = Object.entries(sourceCount)
            .sort((a, b) => b[1] - a[1])
            .map(([source]) => source);
        
        // Generate colors
        const colors = this.generateColorPalette(sortedSources.length);
        
        return {
            labels: sortedSources,
            data: sortedSources.map(source => sourceCount[source]),
            colors
        };
    },
    
    generateColorPalette(count) {
        const baseColors = [
            '#3B82F6', '#10B981', '#F59E0B', '#EF4444', 
            '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6',
            '#F97316', '#A855F7'
        ];
        
        const palette = [];
        for (let i = 0; i < count; i++) {
            palette.push(baseColors[i % baseColors.length]);
        }
        return palette;
    },
    
    populateFdaTable(data, page = 1) {
        const tableBody = document.getElementById('fda-table-body');
        if (!tableBody) return;
        
        // Prepare data for display
        const records = data.combinedResults || [];
        
        if (records.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                        No FDA data available
                    </td>
                </tr>
            `;
            return;
        }
        
        // Group records by source
        const groupedRecords = this.groupFdaRecords(records);
        const groupEntries = Object.entries(groupedRecords);
        
        // Pagination
        const state = window.pageState.fda;
        const start = (page - 1) * state.size;
        const paginatedGroups = groupEntries.slice(start, start + state.size);
        
        // Render grouped table
        tableBody.innerHTML = paginatedGroups.map(([source, items]) => `
            <tr class="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 group">
                <td colspan="5" class="px-6 py-4">
                    <div class="flex justify-between items-center cursor-pointer" 
                         onclick="toggleFdaGroup('${source.replace(/[^a-zA-Z0-9]/g, '-')}-group')">
                        <div>
                            <div class="font-light text-gray-900 dark:text-gray-100">${source}</div>
                            <div class="text-sm text-gray-500 dark:text-gray-400">
                                ${items.length} record${items.length > 1 ? 's' : ''}
                            </div>
                        </div>
                        <svg class="w-5 h-5 transform transition-transform duration-200 dark:stroke-white" 
                             fill="none" 
                             stroke="currentColor" 
                             viewBox="0 0 24 24">
                            <path stroke-linecap="round" 
                                  stroke-linejoin="round" 
                                  stroke-width="2" 
                                  d="M19 9l-7 7-7-7"/>
                        </svg>
                    </div>
                </td>
            </tr>
            <tr id="${source.replace(/[^a-zA-Z0-9]/g, '-')}-group" 
                class="hidden bg-gray-50 dark:bg-gray-700">
                <td colspan="5" class="px-6 py-4">
                    <div class="space-y-4">
                        ${items.map(item => `
                            <div class="flex justify-between items-center py-2 border-b dark:border-gray-600">
                                <div>
                                    <div class="font-light dark:text-gray-200">
                                        ${item.name || 'Unnamed Record'}
                                        ${item.date ? 
                                            `<span class="text-sm text-gray-500 dark:text-gray-400">
                                                (${this.formatDate(item.date)})
                                            </span>` : 
                                            ''}
                                    </div>
                                    <div class="text-sm text-gray-500 dark:text-gray-400">
                                        ${item.description?.substring(0, 100) || 'No description'}${item.description?.length > 100 ? '...' : ''}
                                    </div>
                                </div>
                                <div class="flex items-center space-x-4">
                                    <span class="px-2 py-1 text-sm rounded-full ${this.getStatusBadgeColor(item.status)}">
                                        ${item.status || 'Unknown Status'}
                                    </span>
                                    <button onclick="showFdaDetails('${this.createRecordId(item)}')"
                                            class="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200">
                                        Details
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </td>
            </tr>
        `).join('');
        
        // Add the toggle function to window if it doesn't exist
        if (!window.toggleFdaGroup) {
            window.toggleFdaGroup = function(groupId) {
                const group = document.getElementById(groupId);
                if (!group) return;
                
                const arrow = group.previousElementSibling.querySelector('svg');
                
                // Toggle visibility
                group.classList.toggle('hidden');
                
                // Animate arrow
                if (arrow) {
                    arrow.style.transform = group.classList.contains('hidden') ? 
                        'rotate(0deg)' : 'rotate(180deg)';
                }
            };
        }
        
        // Update pagination UI
        this.updateFdaPaginationUI(groupEntries.length, page);
    },
    
    createRecordId(item) {
        // Create a unique ID for the record to use in the details view
        return btoa(JSON.stringify({
            name: item.name || '',
            source: item.source || '',
            date: item.date || ''
        })).replace(/=/g, '');
    },
    
    groupFdaRecords(records) {
        // Group records by source
        return records.reduce((groups, record) => {
            const source = record.source || 'Unknown Source';
            if (!groups[source]) {
                groups[source] = [];
            }
            groups[source].push(record);
            return groups;
        }, {});
    },
    
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        try {
            // Handle YYYYMMDD format
            if (dateString.length === 8 && !isNaN(dateString)) {
                const year = dateString.substring(0, 4);
                const month = dateString.substring(4, 6);
                const day = dateString.substring(6, 8);
                const date = new Date(year, month - 1, day);
                
                if (!isNaN(date.getTime())) {
                    return date.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
                }
            }
    
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            }
    
            return dateString;
        } catch (error) {
            console.warn(`Date parsing error for ${dateString}:`, error);
            return dateString;
        }
    },
    
    getStatusBadgeColor(status) {
        if (!status) return 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200';
        
        status = status.toLowerCase();
        
        if (status.includes('approved') || status.includes('success') || status.includes('active')) {
            return 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200';
        }
        
        if (status.includes('pending') || status.includes('in review')) {
            return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200';
        }
        
        if (status.includes('denied') || status.includes('rejected') || status.includes('failed')) {
            return 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200';
        }
        
        return 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200';
    },
    
    updateFdaPaginationUI(total, currentPage) {
        const state = window.pageState.fda;
        const totalPages = Math.ceil(total / state.size);
        
        // Update page numbers
        const startEl = document.getElementById('fdaPageStart');
        const endEl = document.getElementById('fdaPageEnd');
        const totalEl = document.getElementById('fdaTotal');
        
        if (startEl) {
            startEl.textContent = ((currentPage - 1) * state.size) + 1;
        }
        if (endEl) {
            endEl.textContent = Math.min(currentPage * state.size, total);
        }
        if (totalEl) {
            totalEl.textContent = total;
        }
        
        // Update button states
        const prevButton = document.getElementById('fdaPrevPage');
        const nextButton = document.getElementById('fdaNextPage');
    
        if (prevButton) {
            prevButton.disabled = currentPage === 1;
            prevButton.classList.toggle('opacity-50', currentPage === 1);
        }
    
        if (nextButton) {
            nextButton.disabled = currentPage >= totalPages;
            nextButton.classList.toggle('opacity-50', currentPage >= totalPages);
        }
    },
    
    setupFdaPaginationHandlers() {
        // FDA pagination
        document.getElementById('fdaPrevPage')?.addEventListener('click', () => {
            if (window.pageState.fda.current > 1) {
                window.pageState.fda.current--;
                this.populateFdaTable(this.competitorData.fdaApprovals, window.pageState.fda.current);
            }
        });
    
        document.getElementById('fdaNextPage')?.addEventListener('click', () => {
            const records = this.competitorData.fdaApprovals?.combinedResults || [];
            const groupedRecords = this.groupFdaRecords(records);
            const totalGroups = Object.keys(groupedRecords).length;
            const totalPages = Math.ceil(totalGroups / window.pageState.fda.size);
            
            if (window.pageState.fda.current < totalPages) {
                window.pageState.fda.current++;
                this.populateFdaTable(this.competitorData.fdaApprovals, window.pageState.fda.current);
            }
        });
    },
    
    setupFdaTableSearch() {
        const searchInput = document.getElementById('fdaSearch');
        if (!searchInput) return;
        
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            this.filterFdaTable(searchTerm);
        });
    },
    
    filterFdaTable(searchTerm) {
        const tableBody = document.getElementById('fda-table-body');
        if (!tableBody) return;
        
        // Reset table if search is empty
        if (!searchTerm) {
            const rows = Array.from(tableBody.getElementsByTagName('tr'));
            rows.forEach(row => {
                row.style.display = '';
                if (row.id && row.id.includes('-group')) {
                    row.classList.add('hidden');
                }
            });
            return;
        }
        
        const rows = Array.from(tableBody.getElementsByTagName('tr'));
        const groupsWithVisibleChildren = new Set();
        
        // First pass: check individual records
        rows.forEach(row => {
            if (row.id && row.id.includes('-group')) {
                const recordEntries = row.querySelectorAll('.flex.justify-between');
                let hasVisibleChild = false;
                
                recordEntries.forEach(entry => {
                    const text = entry.textContent.toLowerCase();
                    const isVisible = text.includes(searchTerm);
                    entry.style.display = isVisible ? '' : 'none';
                    if (isVisible) hasVisibleChild = true;
                });
                
                if (hasVisibleChild) {
                    const groupId = row.id.replace('-group', '');
                    groupsWithVisibleChildren.add(groupId);
                }
            }
        });
        
        // Second pass: show/hide groups based on their children
        rows.forEach(row => {
            if (!row.id) {
                const groupId = row.querySelector('.flex.justify-between')?.
                    getAttribute('onclick')?.
                    match(/'([^']+)/)?.[1]?.
                    replace('-group', '');
                    
                if (groupId) {
                    const hasVisibleChildren = groupsWithVisibleChildren.has(groupId);
                    row.style.display = hasVisibleChildren ? '' : 'none';
                    
                    const groupContent = document.getElementById(groupId + '-group');
                    if (groupContent) {
                        groupContent.style.display = hasVisibleChildren ? '' : 'none';
                        if (hasVisibleChildren) {
                            groupContent.classList.remove('hidden');
                        }
                    }
                }
            }
        });
    },
    
    setupFdaModal() {
        const modal = document.getElementById('fda-detail-modal');
        const closeButton = document.getElementById('fda-modal-close');
    
        if (!modal) {
            // Create modal if it doesn't exist
            const modalHtml = `
                <div id="fda-detail-modal" class="fixed inset-0 z-50 hidden overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-4">
                    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-screen overflow-y-auto">
                        <div class="flex justify-between items-center border-b dark:border-gray-700 p-4">
                            <h3 id="fda-modal-title" class="text-lg font-medium text-gray-900 dark:text-white">Record Details</h3>
                            <button id="fda-modal-close" class="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300">
                                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div id="fda-modal-content" class="p-6"></div>
                    </div>
                </div>
            `;
            
            // Append to body
            const modalContainer = document.createElement('div');
            modalContainer.innerHTML = modalHtml;
            document.body.appendChild(modalContainer.firstElementChild);
            
            // Get references after creation
            modal = document.getElementById('fda-detail-modal');
            closeButton = document.getElementById('fda-modal-close');
        }
    
        if (closeButton) {
            closeButton.onclick = () => {
                modal?.classList.add('hidden');
            };
        }
    
        window.onclick = (event) => {
            if (event.target === modal) {
                modal?.classList.add('hidden');
            }
        };
        
        // Add the showFdaDetails function to window
        if (!window.showFdaDetails) {
            window.showFdaDetails = (recordId) => {
                try {
                    // Decode the record ID
                    const recordInfo = JSON.parse(atob(recordId));
                    
                    // Find the record in the global data
                    const records = window.globalFDAData?.results || [];
                    const record = records.find(r => 
                        r.name === recordInfo.name && 
                        r.source === recordInfo.source && 
                        r.date === recordInfo.date
                    );
                    
                    if (!record) return;
                    
                    const modal = document.getElementById('fda-detail-modal');
                    const modalTitle = document.getElementById('fda-modal-title');
                    const modalContent = document.getElementById('fda-modal-content');
                    
                    if (!modal || !modalTitle || !modalContent) return;
                    
                    modalTitle.textContent = `FDA Record: ${record.name || 'Unnamed Record'}`;
                    
                    modalContent.innerHTML = `
                        <div class="space-y-6">
                            <div class="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg">
                                <div class="flex justify-between items-center">
                                    <div>
                                        <h4 class="font-semibold text-blue-900 dark:text-blue-100">Record Information</h4>
                                        <p class="text-sm text-blue-700 dark:text-blue-200">
                                            Source: ${record.source || 'Unknown'}
                                        </p>
                                    </div>
                                    <span class="px-3 py-1 text-sm rounded-full bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200">
                                        ${record.status || 'Status Unknown'}
                                    </span>
                                </div>
                            </div>
                            
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <p class="text-sm text-gray-600 dark:text-gray-400">Date</p>
                                    <p class="font-light dark:text-white">${window.formatDate ? window.formatDate(record.date) : (record.date || 'Not specified')}</p>
                                </div>
                                <div>
                                    <p class="text-sm text-gray-600 dark:text-gray-400">Record Name</p>
                                    <p class="font-light dark:text-white">${record.name || 'Not specified'}</p>
                                </div>
                            </div>
                            
                            <div class="border dark:border-gray-700 rounded-lg p-4">
                                <h5 class="font-light mb-2 dark:text-white">Description</h5>
                                <p class="text-gray-700 dark:text-gray-300">${record.description || 'No description available'}</p>
                            </div>
                            
                            ${Object.entries(record)
                                .filter(([key]) => !['source', 'name', 'description', 'date', 'status'].includes(key))
                                .map(([key, value]) => `
                                    <div class="border-t dark:border-gray-700 pt-4">
                                        <h5 class="font-light mb-2 dark:text-white">${key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}</h5>
                                        <p class="text-gray-700 dark:text-gray-300">
                                            ${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}
                                        </p>
                                    </div>
                                `).join('')}
                        </div>
                    `;
                    
                    modal.classList.remove('hidden');
                    
                } catch (error) {
                    console.error('Error showing FDA details:', error);
                }
            };
        }
    },
    
    showFdaErrorState(error) {
        const summaryContent = document.getElementById('fda-summary-content');
        if (summaryContent) {
            summaryContent.innerHTML = `
                <div class="bg-red-50 dark:bg-red-900 p-6 rounded-lg shadow">
                    <h3 class="text-lg font-medium text-red-900 dark:text-red-100 mb-2">Error Loading FDA Data</h3>
                    <p class="text-red-600 dark:text-red-300">${error.message}</p>
                </div>
            `;
        }
        
        // Show error message in table
        const tableBody = document.getElementById('fda-table-body');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-4 text-center text-red-500 dark:text-red-400">
                        Error loading FDA data: ${error.message}
                    </td>
                </tr>
            `;
        }
        
        // Hide charts
        const chartContainers = document.querySelectorAll('[id^="fda-"][id$="-chart"]');
        chartContainers.forEach(container => {
            if (container.parentElement) {
                container.parentElement.classList.add('hidden');
            }
        });
    },
    
    // // Render Clinical Trials data tab
    // renderTrialsData() {
    //     // Get trials data
    //     const trialData = this.competitorData.clinicalTrials || [];
    //     this.logData('Clinical Trials Data for Rendering', trialData);
        
    //     // Set trial counts
    //     document.getElementById('total-trials-count').textContent = trialData.length;
        
    //     const recruitingTrials = trialData.filter(t => t.status === 'Recruiting').length;
    //     document.getElementById('recruiting-trials-count').textContent = recruitingTrials;
        
    //     const activeTrials = trialData.filter(t => t.status === 'Active, not recruiting').length;
    //     document.getElementById('active-trials-count').textContent = activeTrials;
        
    //     const completedTrials = trialData.filter(t => t.status === 'Completed').length;
    //     document.getElementById('completed-trials-count').textContent = completedTrials;
        
    //     // Populate trials table
    //     const trialsTableBody = document.getElementById('trials-table-body');
    //     trialsTableBody.innerHTML = '';
        
    //     if (trialData.length > 0) {
    //         trialData.forEach(trial => {
    //             const row = document.createElement('tr');
    //             row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
                
    //             // Determine status color
    //             let statusColor;
    //             switch (trial.status) {
    //                 case 'Recruiting':
    //                 case 'Not yet recruiting':
    //                     statusColor = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    //                     break;
    //                 case 'Active, not recruiting':
    //                     statusColor = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    //                     break;
    //                 case 'Completed':
    //                     statusColor = 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    //                     break;
    //                 case 'Terminated':
    //                 case 'Withdrawn':
    //                     statusColor = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    //                     break;
    //                 default:
    //                     statusColor = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    //             }
                
    //             row.innerHTML = `
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm">
    //                     <span class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}">
    //                         ${trial.status || 'Unknown'}
    //                     </span>
    //                 </td>
    //                 <td class="px-6 py-4 text-sm text-gray-900 dark:text-white">
    //                     ${trial.title || 'Unknown'}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     ${trial.phase || 'Unknown'}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     ${trial.sponsor || 'Unknown'}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     ${trial.startDate || 'Unknown'}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">
    //                     <button class="view-trial-details" data-trial-id="${trial.nctId || ''}">View Details</button>
    //                 </td>
    //             `;
                
    //             trialsTableBody.appendChild(row);
                
    //             // Add event listener to trial detail button
    //             const button = row.querySelector('.view-trial-details');
    //             button.addEventListener('click', () => this.showTrialDetails(trial));
    //         });
    //     } else {
    //         const row = document.createElement('tr');
    //         row.innerHTML = `
    //             <td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
    //                 No clinical trial data available
    //             </td>
    //         `;
    //         trialsTableBody.appendChild(row);
    //     }
    // },
    
    // // Show trial details modal
    // showTrialDetails(trial) {
    //     const modal = document.getElementById('trial-detail-modal');
    //     const modalTitle = document.getElementById('trial-modal-title');
    //     const modalContent = document.getElementById('trial-modal-content');
        
    //     // Set modal title
    //     modalTitle.textContent = 'Clinical Trial Details';
        
    //     // Set modal content
    //     modalContent.innerHTML = `
    //         <div class="mb-4">
    //             <h4 class="text-lg font-medium text-gray-900 dark:text-white">${trial.title || 'Unknown Title'}</h4>
    //             <p class="text-sm text-gray-500 dark:text-gray-400">
    //                 NCT ID: <a href="https://clinicaltrials.gov/study/${trial.nctId}" target="_blank" class="text-blue-600 dark:text-blue-400 hover:underline">${trial.nctId || 'Unknown'}</a>
    //             </p>
    //         </div>
            
    //         <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
    //             <div>
    //                 <h5 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Study Details</h5>
    //                 <p class="text-sm mb-1"><span class="font-medium">Status:</span> ${trial.status || 'Unknown'}</p>
    //                 <p class="text-sm mb-1"><span class="font-medium">Phase:</span> ${trial.phase || 'Unknown'}</p>
    //                 <p class="text-sm mb-1"><span class="font-medium">Conditions:</span> ${trial.conditions || 'Not specified'}</p>
    //                 <p class="text-sm mb-1"><span class="font-medium">Sponsor:</span> ${trial.sponsor || 'Unknown'}</p>
    //             </div>
                
    //             <div>
    //                 <h5 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Timeline</h5>
    //                 <p class="text-sm mb-1"><span class="font-medium">Start Date:</span> ${trial.startDate || 'Unknown'}</p>
    //                 <p class="text-sm mb-1"><span class="font-medium">Completion Date:</span> ${trial.completionDate || 'Unknown'}</p>
    //                 <p class="text-sm mb-1"><span class="font-medium">Enrollment:</span> ${trial.enrollment || 'Unknown'} participants</p>
    //             </div>
    //         </div>
            
    //         <div class="mb-4">
    //             <a href="https://clinicaltrials.gov/study/${trial.nctId}" target="_blank" class="px-4 py-2 bg-marcomm-blue text-white rounded-md text-sm hover:bg-marcomm-blue-dark transition-colors inline-flex items-center">
    //                 <i class="fas fa-external-link-alt mr-2"></i> View on ClinicalTrials.gov
    //             </a>
    //         </div>
    //     `;
        
    //     // Show modal
    //     modal.classList.remove('hidden');
    // },
    // Enhanced Clinical Trials Components with improved metrics, pagination and search
// Render Clinical Trials data tab with more detailed metrics
renderTrialsData() {
    // Get trials data
    const trialData = this.competitorData.clinicalTrials || [];
    this.logData('Clinical Trials Data for Rendering', trialData);
  
    // Store trial data globally for table filtering
    window.globalTrialData = {
      trials: trialData,
      filteredTrials: trialData,
      currentPage: 1,
      itemsPerPage: 8,
      sortBy: 'startDate',
      sortDir: 'desc'
    };
    
    // Enhanced metrics section
    this.renderTrialMetrics(trialData);
    
    // Enhanced visualization section
    this.renderTrialCharts(trialData);
    
    // Paginated and searchable table
    this.renderTrialTable();
    
    // Setup search, filter, and pagination
    this.setupTrialTableControls();
    
    // Setup modal for detailed trial viewing
    this.setupTrialModal();
  },
  
  // Render enhanced trial metrics with more detailed information
  renderTrialMetrics(trialData) {
    // Basic counts
    document.getElementById('total-trials-count').textContent = trialData.length;
    
    // Count by status
    const statusCounts = {
      recruiting: trialData.filter(t => t.status === 'Recruiting').length,
      active: trialData.filter(t => t.status === 'Active, not recruiting').length,
      completed: trialData.filter(t => t.status === 'Completed').length,
      notYetRecruiting: trialData.filter(t => t.status === 'Not yet recruiting').length,
      terminated: trialData.filter(t => 
        t.status === 'Terminated' || 
        t.status === 'Withdrawn' || 
        t.status === 'Suspended').length
    };
    
    document.getElementById('recruiting-trials-count').textContent = statusCounts.recruiting;
    document.getElementById('active-trials-count').textContent = statusCounts.active;
    document.getElementById('completed-trials-count').textContent = statusCounts.completed;
    
    // Add new metrics section
    const metricsContainer = document.getElementById('trial-metrics-container');
    if (!metricsContainer) return;
    
    // Clear container
    metricsContainer.innerHTML = '';
    
    // Advanced metrics
    const phaseDistribution = this.getTrialPhaseDistribution(trialData);
    const enrollmentStats = this.getTrialEnrollmentStats(trialData);
    const trialLocations = this.getTrialLocationStats(trialData);
    
    // Render metrics grid
    metricsContainer.innerHTML = `
      <div class="grid grid-cols-2 gap-2 mt-2">
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Trials</h3>
          <p class="text-xl font-light mt-2 text-gray-900 dark:text-white">${trialData.length}</p>
          <div class="mt-2 flex items-center text-sm space-x-2 hidden">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
              ${statusCounts.recruiting + statusCounts.active + statusCounts.notYetRecruiting} Active
            </span>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
              ${statusCounts.completed} Completed
            </span>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
              ${statusCounts.terminated} Terminated
            </span>
          </div>
        </div>
        
     <!--   <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">By Phase</h3>
          <div class="grid grid-cols-4 gap-2 mt-2">
            ${Object.entries(phaseDistribution).map(([phase, count]) => `
              <div class="text-center">
                <div class="text-lg font-light text-gray-900 dark:text-white">${count}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">${phase}</div>
              </div>
            `).join('')}
          </div>
        </div> -->
        
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Enrollment</h3>
          <p class="text-xl font-light mt-2 text-gray-900 dark:text-white">${enrollmentStats.totalEnrollment.toLocaleString()}</p>
          <div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Average: ${enrollmentStats.avgEnrollment} participants per trial
          </div>
        </div>
        
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow col-span-1 md:col-span-3">
          <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">By Status</h3>
          <div class="mt-2 relative pt-1">
            <div class="flex h-4 overflow-hidden text-xs rounded-full">
              <div class="flex-grow text-center text-white bg-green-500 rounded-l" style="width: ${this.calculatePercentage(statusCounts.recruiting, trialData.length)}%">
                <span class="p-1">Recruiting</span>
              </div>
              <div class="flex-grow text-center text-white bg-blue-500" style="width: ${this.calculatePercentage(statusCounts.active, trialData.length)}%">
                <span class="p-1">Active</span>
              </div>
              <div class="flex-grow text-center text-white bg-yellow-500" style="width: ${this.calculatePercentage(statusCounts.notYetRecruiting, trialData.length)}%">
                <span class="p-1">Not yet</span>
              </div>
              <div class="flex-grow text-center text-white bg-gray-500" style="width: ${this.calculatePercentage(statusCounts.completed, trialData.length)}%">
                <span class="p-1">Completed</span>
              </div>
              <div class="flex-grow text-center text-white bg-red-500 rounded-r" style="width: ${this.calculatePercentage(statusCounts.terminated, trialData.length)}%">
                <span class="p-1">Terminated</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
  
  // Helper function to calculate percentages for visualization
  calculatePercentage(value, total) {
    if (total === 0) return 0;
    return Math.max(5, Math.round((value / total) * 100)); // Minimum 5% for visibility
  },
  
  // Extract phase distribution from trial data
  getTrialPhaseDistribution(trialData) {
    const phaseMap = {
      'Phase 1': 0,
      'Phase 2': 0,
      'Phase 3': 0,
      'Phase 4': 0
    };
    
    trialData.forEach(trial => {
      const phase = trial.phase || 'Unknown';
      if (phase.includes('Phase 1')) phaseMap['Phase 1']++;
      else if (phase.includes('Phase 2')) phaseMap['Phase 2']++;
      else if (phase.includes('Phase 3')) phaseMap['Phase 3']++;
      else if (phase.includes('Phase 4')) phaseMap['Phase 4']++;
    });
    
    return phaseMap;
  },
  
  // Extract enrollment statistics from trial data
  getTrialEnrollmentStats(trialData) {
    let totalEnrollment = 0;
    let trialsWithEnrollment = 0;
    
    trialData.forEach(trial => {
      if (trial.enrollment) {
        const enrollment = parseInt(trial.enrollment);
        if (!isNaN(enrollment)) {
          totalEnrollment += enrollment;
          trialsWithEnrollment++;
        }
      }
    });
    
    return {
      totalEnrollment,
      avgEnrollment: trialsWithEnrollment > 0 ? 
        Math.round(totalEnrollment / trialsWithEnrollment) : 0
    };
  },
  
  // Extract location statistics from trial data
  getTrialLocationStats(trialData) {
    const locations = {};
    
    trialData.forEach(trial => {
      if (trial.locations) {
        trial.locations.forEach(location => {
          const country = location.country || 'Unknown';
          if (!locations[country]) locations[country] = 0;
          locations[country]++;
        });
      }
    });
    
    return locations;
  },
  
  // Render visualization charts for trial data
  renderTrialCharts(trialData) {
    // Destroy previous charts
    if (this.charts.trialPhase) this.charts.trialPhase.destroy();
    if (this.charts.trialStatus) this.charts.trialStatus.destroy();
    if (this.charts.trialTimeline) this.charts.trialTimeline.destroy();
    
    // Phase distribution chart
    this.renderTrialPhaseChart(trialData);
    
    // Status distribution chart
    this.renderTrialStatusChart(trialData);
    
    // Timeline chart
    this.renderTrialTimelineChart(trialData);
  },
  
  // Render phase distribution chart
  renderTrialPhaseChart(trialData) {
    const ctx = document.getElementById('trial-phase-chart')?.getContext('2d');
    if (!ctx) return;
    
    // Count phases
    const phaseCounts = {};
    trialData.forEach(trial => {
      const phase = trial.phase || 'Unknown';
      if (!phaseCounts[phase]) phaseCounts[phase] = 0;
      phaseCounts[phase]++;
    });
    
    // Sort by phase
    const phaseOrder = {
      'Phase 1': 1,
      'Phase 1/Phase 2': 2,
      'Phase 2': 3,
      'Phase 2/Phase 3': 4,
      'Phase 3': 5,
      'Phase 4': 6,
      'Unknown': 7
    };
    
    const sortedPhases = Object.keys(phaseCounts).sort((a, b) => {
      const aOrder = phaseOrder[a] || 999;
      const bOrder = phaseOrder[b] || 999;
      return aOrder - bOrder;
    });
    
    this.charts.trialPhase = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: sortedPhases,
        datasets: [{
          data: sortedPhases.map(phase => phaseCounts[phase]),
          backgroundColor: [
            '#10B981', // Green
            '#22C55E', // Light green
            '#3B82F6', // Blue
            '#60A5FA', // Light blue
            '#8B5CF6', // Purple
            '#A78BFA', // Light purple
            '#6B7280'  // Gray
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              boxWidth: 12,
              font: {
                size: 11
              }
            }
          },
          title: {
            display: true,
            text: 'Distribution by Phase',
            font: {
              size: 14
            }
          }
        }
      }
    });
  },
  
  // Render status distribution chart
  renderTrialStatusChart(trialData) {
    const ctx = document.getElementById('trial-status-chart')?.getContext('2d');
    if (!ctx) return;
    
    // Count statuses
    const statusCounts = {};
    trialData.forEach(trial => {
      const status = trial.status || 'Unknown';
      if (!statusCounts[status]) statusCounts[status] = 0;
      statusCounts[status]++;
    });
    
    // Sort by count (descending)
    const sortedStatuses = Object.keys(statusCounts).sort((a, b) => 
      statusCounts[b] - statusCounts[a]
    );
    
    // Color map
    const statusColorMap = {
      'Recruiting': '#10B981', // Green
      'Active, not recruiting': '#3B82F6', // Blue
      'Completed': '#6B7280', // Gray
      'Not yet recruiting': '#F59E0B', // Amber
      'Terminated': '#EF4444', // Red
      'Withdrawn': '#DC2626', // Dark Red
      'Suspended': '#F97316', // Orange
      'Unknown status': '#9CA3AF' // Light Gray
    };
    
    this.charts.trialStatus = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sortedStatuses,
        datasets: [{
          label: 'Number of Trials',
          data: sortedStatuses.map(status => statusCounts[status]),
          backgroundColor: sortedStatuses.map(status => 
            statusColorMap[status] || '#9CA3AF'
          )
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          title: {
            display: true,
            text: 'Distribution by Status',
            font: {
              size: 14
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Number of Trials'
            }
          }
        }
      }
    });
  },
  
  // Render timeline chart
  renderTrialTimelineChart(trialData) {
    const ctx = document.getElementById('trial-timeline-chart')?.getContext('2d');
    if (!ctx) return;
    
    // Group by year
    const yearlyTrials = {};
    const currentYear = new Date().getFullYear();
    
    // Initialize years
    for (let year = currentYear - 10; year <= currentYear + 2; year++) {
      yearlyTrials[year] = { started: 0, completed: 0 };
    }
    
    // Count trials by start and completion year
    trialData.forEach(trial => {
      if (trial.startDate) {
        try {
          const startYear = new Date(trial.startDate).getFullYear();
          if (yearlyTrials[startYear]) {
            yearlyTrials[startYear].started++;
          }
        } catch (e) { /* Skip invalid dates */ }
      }
      
      if (trial.completionDate) {
        try {
          const completionYear = new Date(trial.completionDate).getFullYear();
          if (yearlyTrials[completionYear]) {
            yearlyTrials[completionYear].completed++;
          }
        } catch (e) { /* Skip invalid dates */ }
      }
    });
    
    // Filter to years with data
    const yearsWithData = Object.keys(yearlyTrials)
      .filter(year => yearlyTrials[year].started > 0 || yearlyTrials[year].completed > 0)
      .sort();
    
    this.charts.trialTimeline = new Chart(ctx, {
      type: 'line',
      data: {
        labels: yearsWithData,
        datasets: [
          {
            label: 'Started',
            data: yearsWithData.map(year => yearlyTrials[year].started),
            borderColor: '#3B82F6', // Blue
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            tension: 0.3
          },
          {
            label: 'Completed',
            data: yearsWithData.map(year => yearlyTrials[year].completed),
            borderColor: '#10B981', // Green
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Clinical Trial Timeline',
            font: {
              size: 14
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Number of Trials'
            }
          },
          x: {
            title: {
              display: true,
              text: 'Year'
            }
          }
        }
      }
    });
  },
  
  // Render the trials table with pagination and search
  renderTrialTable() {
    const tableBody = document.getElementById('trials-table-body');
    if (!tableBody) return;
    
    // Get current page data
    const globalData = window.globalTrialData;
    const startIndex = (globalData.currentPage - 1) * globalData.itemsPerPage;
    const pageData = globalData.filteredTrials.slice(
      startIndex, 
      startIndex + globalData.itemsPerPage
    );
    
    // Clear the table
    tableBody.innerHTML = '';
    
    // Add data rows
    if (pageData.length > 0) {
      pageData.forEach(trial => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
        
        // Determine status color
        let statusColor;
        switch (trial.status) {
          case 'Recruiting':
            statusColor = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
            break;
          case 'Not yet recruiting':
            statusColor = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
            break;
          case 'Active, not recruiting':
            statusColor = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
            break;
          case 'Completed':
            statusColor = 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
            break;
          case 'Terminated':
          case 'Withdrawn':
          case 'Suspended':
            statusColor = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
            break;
          default:
            statusColor = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
        }
        
        row.innerHTML = `
          <td class="px-4 py-3 whitespace-nowrap">
            <span class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}">
              ${trial.status || 'Unknown'}
            </span>
          </td>
          <td class="px-4 py-3">
            <div class="text-sm font-medium text-gray-900 dark:text-white">
              ${trial.title || 'Unknown'}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              NCT: ${trial.nctId || 'Unknown'} • ${this.formatTrialDates(trial)}
            </div>
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
            ${trial.phase || 'Unknown'}
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
            ${trial.sponsor || 'Unknown'}
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
            ${trial.enrollment ? trial.enrollment.toLocaleString() : 'Unknown'}
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">
            <button class="view-trial-details hover:underline" data-trial-id="${trial.nctId || ''}">View Details</button>
          </td>
        `;
        
        tableBody.appendChild(row);
        
        // Add event listener to trial detail button
        const button = row.querySelector('.view-trial-details');
        button.addEventListener('click', () => this.showTrialDetails(trial));
      });
    } else {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
          No matching clinical trials found
        </td>
      `;
      tableBody.appendChild(row);
    }
    
    // Update pagination UI
    this.updateTrialPagination();
  },
  
  // Format trial dates for display
  formatTrialDates(trial) {
    let dateInfo = '';
    
    if (trial.startDate) {
      dateInfo += `Start: ${this.formatDate(trial.startDate)}`;
    }
    
    if (trial.completionDate) {
      if (dateInfo) dateInfo += ' • ';
      dateInfo += `End: ${this.formatDate(trial.completionDate)}`;
    }
    
    return dateInfo || 'Dates unknown';
  },
  
  // Update pagination controls
  updateTrialPagination() {
    const globalData = window.globalTrialData;
    const totalPages = Math.ceil(globalData.filteredTrials.length / globalData.itemsPerPage);
    
    // Update page indicators
    document.getElementById('trial-current-page').textContent = globalData.currentPage;
    document.getElementById('trial-total-pages').textContent = totalPages;
    document.getElementById('trial-total-count').textContent = globalData.filteredTrials.length;
    document.getElementById('trial-showing-start').textContent = 
      globalData.filteredTrials.length > 0 ? 
        ((globalData.currentPage - 1) * globalData.itemsPerPage) + 1 : 0;
    document.getElementById('trial-showing-end').textContent = 
      Math.min(globalData.currentPage * globalData.itemsPerPage, globalData.filteredTrials.length);
    
    // Enable/disable pagination buttons
    document.getElementById('trial-prev-page').disabled = globalData.currentPage <= 1;
    document.getElementById('trial-prev-page').classList.toggle('opacity-50', globalData.currentPage <= 1);
    
    document.getElementById('trial-next-page').disabled = globalData.currentPage >= totalPages;
    document.getElementById('trial-next-page').classList.toggle('opacity-50', globalData.currentPage >= totalPages);
  },
  
  // Setup table controls (search, filter, sort, pagination)
  setupTrialTableControls() {
    // Search input
    document.getElementById('trial-search').addEventListener('input', (event) => {
      this.filterTrialTable(event.target.value);
    });
    
    // Status filter
    document.getElementById('trial-status-filter')?.addEventListener('change', (event) => {
      this.filterTrialTableByStatus(event.target.value);
    });
    
    // Phase filter
    document.getElementById('trial-phase-filter')?.addEventListener('change', (event) => {
      this.filterTrialTableByPhase(event.target.value);
    });
    
    // Pagination
    document.getElementById('trial-prev-page')?.addEventListener('click', () => {
      if (window.globalTrialData.currentPage > 1) {
        window.globalTrialData.currentPage--;
        this.renderTrialTable();
      }
    });
    
    document.getElementById('trial-next-page')?.addEventListener('click', () => {
      const totalPages = Math.ceil(
        window.globalTrialData.filteredTrials.length / window.globalTrialData.itemsPerPage
      );
      
      if (window.globalTrialData.currentPage < totalPages) {
        window.globalTrialData.currentPage++;
        this.renderTrialTable();
      }
    });
  },
  
  // Filter trials by search text
  filterTrialTable(searchText) {
    if (!window.globalTrialData) return;
    
    const statusFilter = document.getElementById('trial-status-filter')?.value || 'all';
    const phaseFilter = document.getElementById('trial-phase-filter')?.value || 'all';
    
    window.globalTrialData.filteredTrials = window.globalTrialData.trials.filter(trial => {
      // Text search
      const matchesSearch = !searchText || (
        (trial.title && trial.title.toLowerCase().includes(searchText.toLowerCase())) ||
        (trial.nctId && trial.nctId.toLowerCase().includes(searchText.toLowerCase())) ||
        (trial.sponsor && trial.sponsor.toLowerCase().includes(searchText.toLowerCase()))
      );
      
      // Status filter
      const matchesStatus = statusFilter === 'all' || trial.status === statusFilter;
      
      // Phase filter
      const matchesPhase = phaseFilter === 'all' || 
        (trial.phase && trial.phase.toLowerCase().includes(phaseFilter.toLowerCase()));
      
      return matchesSearch && matchesStatus && matchesPhase;
    });
    
    // Reset to first page
    window.globalTrialData.currentPage = 1;
    
    // Re-render table
    this.renderTrialTable();
  },
  
  // Filter trials by status
  filterTrialTableByStatus(status) {
    if (!window.globalTrialData) return;
    
    const searchText = document.getElementById('trial-search')?.value || '';
    const phaseFilter = document.getElementById('trial-phase-filter')?.value || 'all';
    
    // Apply filters
    window.globalTrialData.filteredTrials = window.globalTrialData.trials.filter(trial => {
      // Text search
      const matchesSearch = !searchText || (
        (trial.title && trial.title.toLowerCase().includes(searchText.toLowerCase())) ||
        (trial.nctId && trial.nctId.toLowerCase().includes(searchText.toLowerCase())) ||
        (trial.sponsor && trial.sponsor.toLowerCase().includes(searchText.toLowerCase()))
      );
      
      // Status filter
      const matchesStatus = status === 'all' || trial.status === status;
      
      // Phase filter
      const matchesPhase = phaseFilter === 'all' || 
        (trial.phase && trial.phase.toLowerCase().includes(phaseFilter.toLowerCase()));
      
      return matchesSearch && matchesStatus && matchesPhase;
    });
    
    // Reset to first page
    window.globalTrialData.currentPage = 1;
    
    // Re-render table
    this.renderTrialTable();
  },
  
  // Filter trials by phase
  filterTrialTableByPhase(phase) {
    if (!window.globalTrialData) return;
    
    const searchText = document.getElementById('trial-search')?.value || '';
    const statusFilter = document.getElementById('trial-status-filter')?.value || 'all';
    
    // Apply filters
    window.globalTrialData.filteredTrials = window.globalTrialData.trials.filter(trial => {
      // Text search
      const matchesSearch = !searchText || (
        (trial.title && trial.title.toLowerCase().includes(searchText.toLowerCase())) ||
        (trial.nctId && trial.nctId.toLowerCase().includes(searchText.toLowerCase())) ||
        (trial.sponsor && trial.sponsor.toLowerCase().includes(searchText.toLowerCase()))
      );
      
      // Status filter
      const matchesStatus = statusFilter === 'all' || trial.status === statusFilter;
      
      // Phase filter
      const matchesPhase = phase === 'all' || 
        (trial.phase && trial.phase.toLowerCase().includes(phase.toLowerCase()));
      
      return matchesSearch && matchesStatus && matchesPhase;
    });
    
    // Reset to first page
    window.globalTrialData.currentPage = 1;
    
    // Re-render table
    this.renderTrialTable();
  },
  
  // Setup enhanced trial modal
  setupTrialModal() {
    const modal = document.getElementById('trial-detail-modal');
    const closeButton = document.getElementById('trial-modal-close');
    
    if (!modal || !closeButton) return;
    
    // Close modal when clicking X button
    closeButton.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    
    // Close modal when clicking outside
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        modal.classList.add('hidden');
      }
    });
    
    // Close modal on Escape key
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
      }
    });
  },
  
  // Show enhanced trial details modal with API data
  async showTrialDetails(trial) {
    const modal = document.getElementById('trial-detail-modal');
    const modalTitle = document.getElementById('trial-modal-title');
    const modalContent = document.getElementById('trial-modal-content');
    
    if (!modal || !modalTitle || !modalContent) return;
    
    // Set modal title with trial title if available
    modalTitle.textContent = trial.title || 'Clinical Trial Details';
    
    // Show loading state
    modalContent.innerHTML = `
      <div class="flex justify-center items-center p-8">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    `;
    modal.classList.remove('hidden');
    
    try {
      // Fetch detailed trial data from the API
      const response = await fetch(`/api/studies/${trial.nctId}`);
      
      if (!response.ok) {
        throw new Error(`Error fetching trial details: ${response.status}`);
      }
      
      const result = await response.json();
      const trialData = result.data;
      
      // Log the detailed data for debugging
      console.log('Detailed trial data:', trialData);
      
      // Parse and render the detailed trial data
      // Extract key data from the API response
      const protocolSection = trialData.protocolSection || {};
      const identificationModule = protocolSection.identificationModule || {};
      const statusModule = protocolSection.statusModule || {};
      const sponsorCollaboratorsModule = protocolSection.sponsorCollaboratorsModule || {};
      const designModule = protocolSection.designModule || {};
      const eligibilityModule = protocolSection.eligibilityModule || {};
      const contactsLocationsModule = protocolSection.contactsLocationsModule || {};
      const descriptionModule = protocolSection.descriptionModule || {};
      
      // Build a rich content display
      modalContent.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Overview Section -->
          <div class="lg:col-span-2 space-y-4">
            <div class="bg-blue-50 dark:bg-blue-900 rounded-lg p-4">
              <div class="flex items-center space-x-2 mb-2">
                <span class="px-2 py-1 inline-flex text-xs font-semibold rounded-full ${this.getStatusBadgeColor(statusModule.overallStatus)}">
                  ${statusModule.overallStatus || 'Unknown Status'}
                </span>
                <span class="px-2 py-1 inline-flex text-xs font-semibold rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                  ${designModule.phases?.join(', ') || 'No Phase Specified'}
                </span>
              </div>
              
              <h3 class="font-medium text-lg text-blue-900 dark:text-blue-100">
                ${identificationModule.briefTitle || 'Untitled Study'}
              </h3>
              
              <div class="text-sm text-blue-800 dark:text-blue-200 mt-1">
                <span class="font-semibold">NCT ID:</span> ${identificationModule.nctId || 'Unknown'}
              </div>
            </div>
            
            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Study Description</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                ${descriptionModule?.briefSummary || 'No description available'}
              </p>
            </div>
            
            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Eligibility Criteria</h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Minimum Age:</span>
                  <span class="text-sm text-gray-600 dark:text-gray-400">${eligibilityModule?.minimumAge || 'Not specified'}</span>
                </div>
                <div>
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Maximum Age:</span>
                  <span class="text-sm text-gray-600 dark:text-gray-400">${eligibilityModule?.maximumAge || 'Not specified'}</span>
                </div>
                <div>
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Gender:</span>
                  <span class="text-sm text-gray-600 dark:text-gray-400">${eligibilityModule?.sex || 'Not specified'}</span>
                </div>
                <div>
                  <span class="font-medium text-sm text-gray-700 dark:text-gray-300">Healthy Volunteers:</span>
                  <span class="text-sm text-gray-600 dark:text-gray-400">${eligibilityModule?.healthyVolunteers || 'Not specified'}</span>
                </div>
              </div>
              
              <div class="text-sm">
                <div class="mb-2">
                  <h5 class="font-medium text-gray-700 dark:text-gray-300">Inclusion Criteria:</h5>
                  <ul class="list-disc pl-5 text-sm text-gray-600 dark:text-gray-400 space-y-1 mt-1">
                    ${this.formatCriteriaList(eligibilityModule?.inclusionCriteria)}
                  </ul>
                </div>
                <div>
                  <h5 class="font-medium text-gray-700 dark:text-gray-300">Exclusion Criteria:</h5>
                  <ul class="list-disc pl-5 text-sm text-gray-600 dark:text-gray-400 space-y-1 mt-1">
                    ${this.formatCriteriaList(eligibilityModule?.exclusionCriteria)}
                  </ul>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Sidebar -->
          <div class="space-y-4">
            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Study Details</h4>
              <dl class="space-y-2">
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Study Type</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">${designModule?.studyType || 'Not specified'}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Allocation</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">${designModule?.designInfo?.allocation || 'Not specified'}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Intervention Model</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">${designModule?.designInfo?.interventionModel || 'Not specified'}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Primary Purpose</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">${designModule?.designInfo?.primaryPurpose || 'Not specified'}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Masking</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">${designModule?.designInfo?.masking || 'Not specified'}</dd>
                </div>
              </dl>
            </div>
            
            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Sponsor & Collaborators</h4>
              <div class="space-y-2">
                <div>
                  <span class="text-xs text-gray-500 dark:text-gray-400">Lead Sponsor</span>
                  <p class="text-sm text-gray-700 dark:text-gray-300">${sponsorCollaboratorsModule?.leadSponsor?.name || 'Not specified'}</p>
                </div>
                ${sponsorCollaboratorsModule?.collaborators?.length ? `
                  <div>
                    <span class="text-xs text-gray-500 dark:text-gray-400">Collaborators</span>
                    <ul class="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1 mt-1">
                      ${sponsorCollaboratorsModule.collaborators.map(c => `
                        <li>${c.name || 'Unnamed Collaborator'}</li>
                      `).join('')}
                    </ul>
                  </div>
                ` : ''}
              </div>
            </div>
            
            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Timeline</h4>
              <dl class="space-y-2">
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Start Date</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">${statusModule?.startDateStruct?.date || 'Not specified'}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Primary Completion</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">${statusModule?.primaryCompletionDateStruct?.date || 'Not specified'}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Study Completion</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">${statusModule?.completionDateStruct?.date || 'Not specified'}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Last Updated</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">${statusModule?.lastUpdateSubmitDateStruct?.date || 'Not specified'}</dd>
                </div>
              </dl>
            </div>
            
            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Enrollment</h4>
              <dl class="space-y-2">
                <div>
                  <dt class="text-xs text-gray-500 dark:text-gray-400">Target Enrollment</dt>
                  <dd class="text-sm text-gray-700 dark:text-gray-300">
                    ${designModule?.enrollmentInfo?.count || 'Not specified'}
                    ${designModule?.enrollmentInfo?.type ? `(${designModule.enrollmentInfo.type})` : ''}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
        
        <!-- Locations Section -->
        <div class="mt-6">
          <div class="flex justify-between items-center mb-3">
            <h4 class="font-medium text-gray-700 dark:text-gray-300">Study Locations</h4>
            <span class="text-sm text-gray-500 dark:text-gray-400">
              ${contactsLocationsModule?.locations?.length || 0} locations
            </span>
          </div>
          
          ${contactsLocationsModule?.locations?.length ? `
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Facility</th>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">City</th>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">State/Country</th>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  ${contactsLocationsModule.locations.slice(0, 5).map(location => `
                    <tr>
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">${location.facility || 'Not specified'}</td>
                      <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">${location.city || 'Not specified'}</td>
                      <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        ${location.state ? location.state + ', ' : ''}${location.country || 'Not specified'}
                      </td>
                      <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">${location.status || 'Not specified'}</td>
                    </tr>
                  `).join('')}
                  ${contactsLocationsModule.locations.length > 5 ? `
                    <tr>
                      <td colspan="4" class="px-4 py-3 text-sm text-center text-gray-500 dark:text-gray-400">
                        And ${contactsLocationsModule.locations.length - 5} more locations...
                      </td>
                    </tr>
                  ` : ''}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
              No location information available
            </div>
          `}
        </div>
        
        <!-- Footer Actions -->
        <div class="mt-6 flex justify-end space-x-3">
          <a href="https://clinicaltrials.gov/study/${identificationModule.nctId}" 
             target="_blank" 
             class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm transition-colors">
             View on ClinicalTrials.gov
          </a>
        </div>
      `;
    } catch (error) {
      console.error('Error fetching trial details:', error);
      
      // Show error state
      modalContent.innerHTML = `
        <div class="bg-red-50 dark:bg-red-900 rounded-lg p-6 text-center">
          <svg class="mx-auto h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 class="mt-2 text-lg font-medium text-red-800 dark:text-red-200">Unable to load trial details</h3>
          <p class="mt-1 text-sm text-red-700 dark:text-red-300">${error.message}</p>
          <div class="mt-4">
            <a href="https://clinicaltrials.gov/study/${trial.nctId}" 
               target="_blank" 
               class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md text-sm transition-colors">
               View on ClinicalTrials.gov
            </a>
          </div>
        </div>
      `;
    }
  },

// Format criteria list from text
formatCriteriaList(criteriaText) {
  if (!criteriaText) return '<li>Not specified</li>';
  
  // Split text by common delimiters and convert to list items
  const items = criteriaText
    .split(/(?:\r?\n|•|-|\*|(?:\d+\.))+/) // Split by newlines, bullets, or numbered lists
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .map(item => `<li>${item}</li>`)
    .join('');
  
  return items || '<li>Not specified</li>';
},

// Get badge color for status
getStatusBadgeColor(status) {
  if (!status) return 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200';
  
  status = status.toLowerCase();
  
  if (status.includes('recruit')) {
    return 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200';
  }
  
  if (status.includes('active')) {
    return 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200';
  }
  
  if (status.includes('complet')) {
    return 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200';
  }
  
  if (status.includes('terminat') || status.includes('withdraw') || status.includes('suspend')) {
    return 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200';
  }
  
  return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200';
},

    
    // // Render Patents & IP data tab
    // renderPatentsData() {
    //     // Get patents data and orange book data
    //     const patentData = this.competitorData.patents || [];
    //     const orangeBook = this.competitorData.orangeBook || { products: [], patents: [], exclusivity: [], summary: {} };
        
    //     this.logData('Patents Data for Rendering', patentData);
    //     this.logData('Orange Book Data for Rendering', orangeBook);
        
    //     // Show Orange Book section for drugs
    //     if (this.competitorData.type === 'drug') {
    //         document.getElementById('orange-book-section').classList.remove('hidden');
            
    //         // Populate Orange Book data
    //         document.getElementById('ob-products-count').textContent = orangeBook.products?.length || '0';
    //         document.getElementById('ob-patents-count').textContent = orangeBook.patents?.length || '0';
    //         document.getElementById('ob-exclusivity-end').textContent = orangeBook.summary?.exclusivityEnd || 'Unknown';
    //     } else {
    //         document.getElementById('orange-book-section').classList.add('hidden');
    //     }
        
    //     // Populate patents table
    //     const patentsTableBody = document.getElementById('patents-table-body');
    //     patentsTableBody.innerHTML = '';
        
    //     if (patentData.length > 0) {
    //         patentData.forEach(patent => {
    //             const row = document.createElement('tr');
    //             row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
                
    //             row.innerHTML = `
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     ${patent.patentNumber || 'Unknown'}
    //                 </td>
    //                 <td class="px-6 py-4 text-sm text-gray-900 dark:text-white">
    //                     ${patent.title || 'Unknown'}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     ${patent.assignee || 'Unknown'}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     ${patent.date || 'Unknown'}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">
    //                     <button class="view-patent-details">View Details</button>
    //                 </td>
    //             `;
                
    //             patentsTableBody.appendChild(row);
                
    //             // Add event listener to patent detail button
    //             const button = row.querySelector('.view-patent-details');
    //             button.addEventListener('click', () => this.showPatentDetails(patent));
    //         });
    //     } else {
    //         const row = document.createElement('tr');
    //         row.innerHTML = `
    //             <td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
    //                 No patent data available
    //             </td>
    //         `;
    //         patentsTableBody.appendChild(row);
    //     }
    // },
    
    // // Show patent details modal
    // showPatentDetails(patent) {
    //     const modal = document.getElementById('patent-detail-modal');
    //     const modalTitle = document.getElementById('patent-modal-title');
    //     const modalContent = document.getElementById('patent-modal-content');
        
    //     // Set modal title
    //     modalTitle.textContent = 'Patent Details';
        
    //     // Set modal content
    //     modalContent.innerHTML = `
    //         <div class="mb-4">
    //             <h4 class="text-lg font-medium text-gray-900 dark:text-white">${patent.title || 'Unknown Title'}</h4>
    //             <p class="text-sm text-gray-500 dark:text-gray-400">
    //                 Patent Number: ${patent.patentNumber || 'Unknown'}
    //             </p>
    //         </div>
            
    //         <div class="mb-6">
    //             <h5 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Abstract</h5>
    //             <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
    //                 ${patent.abstract || 'No abstract available'}
    //             </p>
    //         </div>
            
    //         <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
    //             <div>
    //                 <h5 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Patent Details</h5>
    //                 <p class="text-sm mb-1"><span class="font-medium">Assignee:</span> ${patent.assignee || 'Unknown'}</p>
    //                 <p class="text-sm mb-1"><span class="font-medium">Filing Date:</span> ${patent.date || 'Unknown'}</p>
    //             </div>
    //         </div>
            
    //         <div class="mb-4">
    //             <a href="https://patents.google.com/patent/US${patent.patentNumber?.replace(/[^\d]/g, '')}" target="_blank" class="px-4 py-2 bg-marcomm-blue text-white rounded-md text-sm hover:bg-marcomm-blue-dark transition-colors inline-flex items-center">
    //                 <i class="fas fa-external-link-alt mr-2"></i> View on Google Patents
    //             </a>
    //         </div>
    //     `;
        
    //     // Show modal
    //     modal.classList.remove('hidden');
    // },
    renderPatentsData() {
        // Get patents data and orange book data
        const patentData = this.competitorData.patents || [];
        const orangeBook = this.competitorData.orangeBook || { products: [], patents: [], exclusivity: [], summary: {} };
        
        this.logData('Patents Data for Rendering', patentData);
        this.logData('Orange Book Data for Rendering', orangeBook);
        
        // Store patent data globally for filtering
        window.globalPatentData = {
          patents: patentData,
          filteredPatents: patentData,
          currentPage: 1,
          itemsPerPage: 8,
          sortBy: 'date',
          sortDir: 'desc'
        };
        
        // Show Orange Book section for drugs
        if (this.competitorData.type === 'drug') {
          document.getElementById('orange-book-section').classList.remove('hidden');
          this.renderOrangeBookData(orangeBook);
        } else {
          document.getElementById('orange-book-section').classList.add('hidden');
        }
        
        // Render patent metrics
        this.renderPatentMetrics(patentData);
        
        // Render patent visualizations
        this.renderPatentCharts(patentData);
        
        // Render paginated patent table
        this.renderPatentTable();
        
        // Setup search, filter, and pagination
        this.setupPatentTableControls();
        
        // Setup modal for detailed patent viewing
        this.setupPatentModal();
      },
      
      // Render Orange Book data for drug products
      renderOrangeBookData(orangeBook) {
        const obSection = document.getElementById('orange-book-section');
        if (!obSection) return;
        
        // Update basic metrics
        document.getElementById('ob-products-count').textContent = orangeBook.products?.length || '0';
        document.getElementById('ob-patents-count').textContent = orangeBook.patents?.length || '0';
        document.getElementById('ob-exclusivity-end').textContent = orangeBook.summary?.exclusivityEnd || 'Unknown';
        
        // Enhanced Orange Book section with more details
        const productsContainer = document.getElementById('ob-products-container');
        if (productsContainer) {
          if (orangeBook.products && orangeBook.products.length > 0) {
            productsContainer.innerHTML = `
              <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <h3 class="text-base font-medium text-gray-700 dark:text-gray-300">Orange Book Products</h3>
                </div>
                <div class="p-4">
                  <div class="space-y-4">
                    ${orangeBook.products.slice(0, 3).map(product => `
                      <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                        <div class="flex justify-between">
                          <div>
                            <h4 class="font-medium text-gray-800 dark:text-gray-200">${product.tradeName || 'Unnamed Product'}</h4>
                            <p class="text-sm text-gray-600 dark:text-gray-400">
                              ${product.activeIngredient || 'Unknown ingredient'} - ${product.dosageForm || 'Unknown form'}
                            </p>
                          </div>
                          <div class="text-right">
                            <span class="text-xs text-gray-500 dark:text-gray-400">Application</span>
                            <p class="text-sm text-gray-700 dark:text-gray-300">${product.applicationNumber || 'Unknown'}</p>
                          </div>
                        </div>
                        <div class="mt-2 text-sm">
                          <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">RLD: ${product.rld || 'Unknown'}</span>
                            <span class="text-gray-600 dark:text-gray-400">RS: ${product.rs || 'Unknown'}</span>
                          </div>
                        </div>
                      </div>
                    `).join('')}
                    ${orangeBook.products.length > 3 ? `
                      <div class="text-center text-sm text-blue-600 dark:text-blue-400">
                        + ${orangeBook.products.length - 3} more products
                      </div>
                    ` : ''}
                  </div>
                </div>
              </div>
            `;
          } else {
            productsContainer.innerHTML = `
              <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
                <p class="text-gray-600 dark:text-gray-400">No Orange Book products found</p>
              </div>
            `;
          }
        }
        
        // Patent exclusivity timeline
        const exclusivityContainer = document.getElementById('ob-exclusivity-container');
        if (exclusivityContainer) {
          if (orangeBook.patents && orangeBook.patents.length > 0) {
            // Sort patents by expiration date
            const sortedPatents = [...orangeBook.patents].sort((a, b) => {
              if (!a.patentExpiry) return 1;
              if (!b.patentExpiry) return -1;
              return new Date(a.patentExpiry) - new Date(b.patentExpiry);
            });
            
            exclusivityContainer.innerHTML = `
              <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <h3 class="text-base font-medium text-gray-700 dark:text-gray-300">Patent Exclusivity Timeline</h3>
                </div>
                <div class="p-4">
                  <div class="relative">
                    <!-- Timeline track -->
                    <div class="absolute h-1 w-full bg-gray-200 dark:bg-gray-700"></div>
                    
                    <!-- Timeline points -->
                    ${this.renderPatentTimelinePoints(sortedPatents)}
                  </div>
                  
                  <div class="mt-8 space-y-2">
                    ${sortedPatents.slice(0, 5).map(patent => `
                      <div class="flex justify-between items-center text-sm border-b border-gray-100 dark:border-gray-800 pb-2">
                        <div>
                          <span class="font-medium text-gray-800 dark:text-gray-200">${patent.patentNumber || 'Unknown'}</span>
                        </div>
                        <div class="text-gray-600 dark:text-gray-400">Expires: ${patent.patentExpiry || 'Unknown'}</div>
                      </div>
                    `).join('')}
                    ${orangeBook.patents.length > 5 ? `
                      <div class="text-center text-sm text-blue-600 dark:text-blue-400">
                        + ${orangeBook.patents.length - 5} more patents
                      </div>
                    ` : ''}
                  </div>
                </div>
              </div>
            `;
          } else {
            exclusivityContainer.innerHTML = `
              <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
                <p class="text-gray-600 dark:text-gray-400">No patent exclusivity data found</p>
              </div>
            `;
          }
        }
      },
      
      // Render patent timeline points for visualization
      renderPatentTimelinePoints(patents) {
        if (!patents || patents.length === 0) return '';
        
        // Find earliest and latest dates
        const dates = patents
          .filter(p => p.patentExpiry)
          .map(p => new Date(p.patentExpiry));
        
        if (dates.length === 0) return '';
        
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        const today = new Date();
        
        // Ensure minimum timespan of 5 years
        const timeSpan = Math.max(5 * 365 * 24 * 60 * 60 * 1000, maxDate - minDate);
        
        // Adjust dates for better visualization
        const adjustedMinDate = new Date(minDate.getTime() - timeSpan * 0.1);
        const adjustedMaxDate = new Date(maxDate.getTime() + timeSpan * 0.1);
        
        return patents
          .filter(p => p.patentExpiry)
          .map(patent => {
            const expiryDate = new Date(patent.patentExpiry);
            const position = ((expiryDate - adjustedMinDate) / (adjustedMaxDate - adjustedMinDate)) * 100;
            const isPast = expiryDate < today;
            
            return `
              <div class="absolute" style="left: ${position}%; top: -10px; transform: translateX(-50%);">
                <div class="h-5 w-5 rounded-full ${isPast ? 'bg-gray-400' : 'bg-blue-500'} border-2 border-white dark:border-gray-800"></div>
                <div class="absolute text-xs text-gray-600 dark:text-gray-400 -ml-10 mt-1 w-20 text-center">
                  ${expiryDate.toLocaleDateString(undefined, { year: 'numeric' })}
                </div>
              </div>
            `;
          })
          .join('');
      },
      
      // Render patent metrics dashboard
      renderPatentMetrics(patentData) {
        // Basic counts
        document.getElementById('patent-count').textContent = patentData.length || '0';
        
        // Add new metrics section
        const metricsContainer = document.getElementById('patent-metrics-container');
        if (!metricsContainer) return;
        
        // Calculate metrics
        const patentsByYear = this.getPatentCountByYear(patentData);
        const latestPatents = patentData.length > 0 ? patentData.slice(0, 3) : [];
        const patentTypes = this.categorizePatentTypes(patentData);
        
        // Render metrics grid
        metricsContainer.innerHTML = `
          <div class="grid grid-cols-3 gap-2 mt-2">
            <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Patents</h3>
              <p class="text-xl font-light mt-2 text-gray-900 dark:text-white">${patentData.length}</p>
              <div class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                ${this.getPatentAgeDescription(patentData)}
              </div>
            </div>
            
            <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Recent Activity</h3>
              <p class="text-xl font-light mt-2 text-gray-900 dark:text-white">
                ${patentsByYear[new Date().getFullYear()] || 0} this year
              </p>
              <div class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                ${patentsByYear[new Date().getFullYear() - 1] || 0} last year
              </div>
            </div>
            
            <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Patent Types</h3>
              <div class="grid grid-cols-3 gap-2 mt-2">
                ${Object.entries(patentTypes).map(([type, count]) => `
                  <div class="text-center">
                    <div class="text-lg font-light text-gray-900 dark:text-white">${count}</div>
                   <div class="text-xs text-gray-500 dark:text-gray-400">${this.formatPatentType(type)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    
    <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-6">
      <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Latest Patents</h3>
      <div class="space-y-3">
        ${latestPatents.length > 0 ? latestPatents.map(patent => `
          <div class="border-b border-gray-100 dark:border-gray-700 pb-2">
            <div class="flex justify-between">
              <div>
                <div class="font-medium text-gray-900 dark:text-white text-sm line-clamp-1">${patent.title || 'Untitled Patent'}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">No. ${patent.patentNumber || 'Unknown'}</div>
              </div>
              <div class="text-right">
                <div class="text-xs text-gray-500 dark:text-gray-400">Date</div>
                <div class="text-sm text-gray-700 dark:text-gray-300">${this.formatDate(patent.date) || 'Unknown'}</div>
              </div>
            </div>
          </div>
        `).join('') : `
          <div class="text-center text-sm text-gray-500 dark:text-gray-400">
            No patent data available
          </div>
        `}
      </div>
    </div>
  `;
},

// Get description of patent portfolio age
getPatentAgeDescription(patents) {
  if (!patents || patents.length === 0) return 'No patents available';
  
  // Calculate average filing age in years
  let totalAge = 0;
  let patentsWithDates = 0;
  const now = new Date();
  
  patents.forEach(patent => {
    if (patent.date) {
      try {
        const filingDate = new Date(patent.date);
        if (!isNaN(filingDate.getTime())) {
          const ageInYears = (now - filingDate) / (365 * 24 * 60 * 60 * 1000);
          totalAge += ageInYears;
          patentsWithDates++;
        }
      } catch (e) { /* Skip invalid dates */ }
    }
  });
  
  if (patentsWithDates === 0) return 'Dates not available';
  
  const averageAge = totalAge / patentsWithDates;
  if (averageAge < 5) return 'Recent portfolio (avg < 5 years)';
  if (averageAge < 10) return 'Mature portfolio (5-10 years)';
  return 'Aging portfolio (> 10 years)';
},

// Get patent count by year
getPatentCountByYear(patents) {
  const countByYear = {};
  
  patents.forEach(patent => {
    if (patent.date) {
      try {
        const filingDate = new Date(patent.date);
        if (!isNaN(filingDate.getTime())) {
          const year = filingDate.getFullYear();
          countByYear[year] = (countByYear[year] || 0) + 1;
        }
      } catch (e) { /* Skip invalid dates */ }
    }
  });
  
  return countByYear;
},

// Categorize patents by type
categorizePatentTypes(patents) {
  const types = {
    'utility': 0,
    'design': 0,
    'method': 0,
    'other': 0
  };
  
  patents.forEach(patent => {
    if (!patent.title && !patent.abstract) {
      types.other++;
      return;
    }
    
    const titleAndAbstract = `${patent.title || ''} ${patent.abstract || ''}`.toLowerCase();
    
    if (titleAndAbstract.includes('design') || titleAndAbstract.includes('ornamental')) {
      types.design++;
    } else if (titleAndAbstract.includes('method') || titleAndAbstract.includes('process')) {
      types.method++;
    } else if (titleAndAbstract.includes('device') || titleAndAbstract.includes('apparatus') || titleAndAbstract.includes('system')) {
      types.utility++;
    } else {
      types.other++;
    }
  });
  
  return types;
},

// Format patent type for display
formatPatentType(type) {
  switch (type) {
    case 'utility': return 'Utility';
    case 'design': return 'Design';
    case 'method': return 'Method';
    case 'other': return 'Other';
    default: return type.charAt(0).toUpperCase() + type.slice(1);
  }
},

// Render patent charts
renderPatentCharts(patentData) {
  // Destroy previous charts
  if (this.charts.patentTimeline) this.charts.patentTimeline.destroy();
  if (this.charts.patentAssignees) this.charts.patentAssignees.destroy();
  
  // Timeline chart
  this.renderPatentTimelineChart(patentData);
  
  // Assignees chart
  this.renderPatentAssigneesChart(patentData);
},

// Render patent timeline chart
renderPatentTimelineChart(patentData) {
  const ctx = document.getElementById('patent-timeline-chart')?.getContext('2d');
  if (!ctx) return;
  
  // Group patents by year
  const patentsByYear = {};
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Initialize years (10 years back to 2 years forward)
  for (let year = currentYear - 10; year <= currentYear + 2; year++) {
    patentsByYear[year] = 0;
  }
  
  // Count patents by year
  patentData.forEach(patent => {
    if (patent.date) {
      try {
        const filingDate = new Date(patent.date);
        if (!isNaN(filingDate.getTime())) {
          const year = filingDate.getFullYear();
          if (patentsByYear[year] !== undefined) {
            patentsByYear[year]++;
          }
        }
      } catch (e) { /* Skip invalid dates */ }
    }
  });
  
  // Filter to years with data and sort
  const yearsWithData = Object.keys(patentsByYear)
    .filter(year => patentsByYear[year] > 0 || year >= currentYear - 5)
    .sort();
  
  this.charts.patentTimeline = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: yearsWithData,
      datasets: [
        {
          label: 'Patents Filed',
          data: yearsWithData.map(year => patentsByYear[year]),
          backgroundColor: ctx => {
            const year = parseInt(yearsWithData[ctx.dataIndex]);
            return year >= currentYear ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.8)';
          },
          borderWidth: 0,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            title: (context) => `Year: ${context[0].label}`,
            label: (context) => `Patents Filed: ${context.raw}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Number of Patents'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Year'
          }
        }
      }
    }
  });
},

// Render patent assignees chart
renderPatentAssigneesChart(patentData) {
  const ctx = document.getElementById('patent-assignees-chart')?.getContext('2d');
  if (!ctx) return;
  
  // Count patents by assignee
  const assigneeCounts = {};
  patentData.forEach(patent => {
    const assignee = patent.assignee || 'Unknown';
    assigneeCounts[assignee] = (assigneeCounts[assignee] || 0) + 1;
  });
  
  // Sort by count (descending) and take top 5
  const topAssignees = Object.entries(assigneeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  // Handle case with no data
  if (topAssignees.length === 0) {
    ctx.canvas.height = 100;
    ctx.font = '14px Arial';
    ctx.fillStyle = '#6B7280';
    ctx.textAlign = 'center';
    ctx.fillText('No assignee data available', ctx.canvas.width / 2, 50);
    return;
  }
  
  // Colors for chart
  const colors = [
    'rgba(59, 130, 246, 0.8)',  // Blue
    'rgba(16, 185, 129, 0.8)',  // Green
    'rgba(249, 115, 22, 0.8)',  // Orange
    'rgba(139, 92, 246, 0.8)',  // Purple
    'rgba(107, 114, 128, 0.8)'  // Gray
  ];
  
  this.charts.patentAssignees = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: topAssignees.map(([assignee]) => assignee),
      datasets: [
        {
          data: topAssignees.map(([_, count]) => count),
          backgroundColor: colors,
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 12,
            font: {
              size: 11
            }
          }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.label || '';
              const value = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = Math.round((value / total) * 100);
              return `${label}: ${value} patents (${percentage}%)`;
            }
          }
        }
      }
    }
  });
},

// Render paginated patent table with search and filters
renderPatentTable() {
  const tableBody = document.getElementById('patents-table-body');
  if (!tableBody) return;
  
  // Get current page data
  const globalData = window.globalPatentData;
  if (!globalData) return;
  
  const startIndex = (globalData.currentPage - 1) * globalData.itemsPerPage;
  const pageData = globalData.filteredPatents.slice(
    startIndex, 
    startIndex + globalData.itemsPerPage
  );
  
  // Clear the table
  tableBody.innerHTML = '';
  
  // Add data rows
  if (pageData.length > 0) {
    pageData.forEach(patent => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
      
      row.innerHTML = `
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
          ${patent.patentNumber || 'Unknown'}
        </td>
        <td class="px-4 py-3">
          <div class="text-sm font-medium text-gray-900 dark:text-white line-clamp-2">
            ${patent.title || 'Unknown'}
          </div>
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
          ${patent.assignee || 'Unknown'}
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
          ${this.formatDate(patent.date) || 'Unknown'}
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">
          <button  style="display: none;" class="view-patent-details hover:underline" data-patent-id="${patent.patentNumber || ''}">View Details</button>
           <a href="https://patents.google.com/patent/US${patent.patentNumber?.replace(/[^\d]/g, '')}" 
           target="_blank" 
           class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm transition-colors">
           View on Google Patents
        </a>
          
        </td>
      `;
      
      tableBody.appendChild(row);
      
      // Add event listener to patent detail button
      const button = row.querySelector('.view-patent-details');
      button.addEventListener('click', () => this.showPatentDetails(patent));
    });
  } else {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        No matching patents found
      </td>
    `;
    tableBody.appendChild(row);
  }
  
  // Update pagination UI
  this.updatePatentPagination();
},

// Update patent pagination controls
updatePatentPagination() {
  const globalData = window.globalPatentData;
  if (!globalData) return;
  
  const totalPages = Math.ceil(globalData.filteredPatents.length / globalData.itemsPerPage);
  
  // Update page indicators
  document.getElementById('patent-current-page').textContent = globalData.currentPage;
  document.getElementById('patent-total-pages').textContent = totalPages;
  document.getElementById('patent-total-count').textContent = globalData.filteredPatents.length;
  document.getElementById('patent-showing-start').textContent = 
    globalData.filteredPatents.length > 0 ? 
      ((globalData.currentPage - 1) * globalData.itemsPerPage) + 1 : 0;
  document.getElementById('patent-showing-end').textContent = 
    Math.min(globalData.currentPage * globalData.itemsPerPage, globalData.filteredPatents.length);
  
  // Enable/disable pagination buttons
  document.getElementById('patent-prev-page').disabled = globalData.currentPage <= 1;
  document.getElementById('patent-prev-page').classList.toggle('opacity-50', globalData.currentPage <= 1);
  
  document.getElementById('patent-next-page').disabled = globalData.currentPage >= totalPages;
  document.getElementById('patent-next-page').classList.toggle('opacity-50', globalData.currentPage >= totalPages);
},

// Setup patent table controls (search, filter, sort, pagination)
setupPatentTableControls() {
  // Search input
  document.getElementById('patent-search').addEventListener('input', (event) => {
    this.filterPatentTable(event.target.value);
  });
  
  // Pagination
  document.getElementById('patent-prev-page')?.addEventListener('click', () => {
    if (window.globalPatentData.currentPage > 1) {
      window.globalPatentData.currentPage--;
      this.renderPatentTable();
    }
  });
  
  document.getElementById('patent-next-page')?.addEventListener('click', () => {
    const totalPages = Math.ceil(
      window.globalPatentData.filteredPatents.length / window.globalPatentData.itemsPerPage
    );
    
    if (window.globalPatentData.currentPage < totalPages) {
      window.globalPatentData.currentPage++;
      this.renderPatentTable();
    }
  });
  
  // Sort controls
  document.getElementById('patent-sort-by')?.addEventListener('change', (event) => {
    window.globalPatentData.sortBy = event.target.value;
    this.sortPatentTable();
  });
  
  document.getElementById('patent-sort-dir')?.addEventListener('change', (event) => {
    window.globalPatentData.sortDir = event.target.value;
    this.sortPatentTable();
  });
},

// Setup enhanced patent modal
setupPatentModal() {
    const modal = document.getElementById('patent-detail-modal');
    const closeButton = document.getElementById('patent-modal-close');
    
    if (!modal || !closeButton) return;
    
    // Close modal when clicking X button
    closeButton.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    
    // Close modal when clicking outside
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        modal.classList.add('hidden');
      }
    });
    
    // Close modal on Escape key
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
      }
    });
  },
  
// Filter patents by search text
filterPatentTable(searchText) {
  if (!window.globalPatentData) return;
  
  // Apply text search filter
  window.globalPatentData.filteredPatents = window.globalPatentData.patents.filter(patent => {
    if (!searchText) return true;
    
    const lowerSearch = searchText.toLowerCase();
    return (
      (patent.title && patent.title.toLowerCase().includes(lowerSearch)) ||
      (patent.patentNumber && patent.patentNumber.toLowerCase().includes(lowerSearch)) ||
      (patent.assignee && patent.assignee.toLowerCase().includes(lowerSearch)) ||
      (patent.abstract && patent.abstract.toLowerCase().includes(lowerSearch))
    );
  });
  
  // Apply current sort
  this.sortPatentTable(false);
  
  // Reset to first page
  window.globalPatentData.currentPage = 1;
  
  // Re-render table
  this.renderPatentTable();
},

// Sort patent table based on current sort settings
sortPatentTable(rerender = true) {
  if (!window.globalPatentData) return;
  
  const { sortBy, sortDir } = window.globalPatentData;
  
  window.globalPatentData.filteredPatents.sort((a, b) => {
    let valueA, valueB;
    
    switch (sortBy) {
      case 'number':
        valueA = a.patentNumber || '';
        valueB = b.patentNumber || '';
        break;
      case 'title':
        valueA = a.title || '';
        valueB = b.title || '';
        break;
      case 'assignee':
        valueA = a.assignee || '';
        valueB = b.assignee || '';
        break;
      case 'date':
      default:
        try {
          valueA = a.date ? new Date(a.date).getTime() : 0;
          valueB = b.date ? new Date(b.date).getTime() : 0;
        } catch (e) {
          valueA = 0;
          valueB = 0;
        }
    }
    
    // Direction multiplier
    const dirMultiplier = sortDir === 'asc' ? 1 : -1;
    
    // Compare
    if (typeof valueA === 'number' && typeof valueB === 'number') {
      return (valueA - valueB) * dirMultiplier;
    } else {
      return String(valueA).localeCompare(String(valueB)) * dirMultiplier;
    }
  });
  
  // Re-render if needed
  if (rerender) {
    this.renderPatentTable();
  }
},

// Show enhanced patent details modal
showPatentDetails(patent) {
  const modal = document.getElementById('patent-detail-modal');
  const modalTitle = document.getElementById('patent-modal-title');
  const modalContent = document.getElementById('patent-modal-content');
  
  if (!modal || !modalTitle || !modalContent) return;
  
  // Set modal title
  modalTitle.textContent = 'Patent Details';
  
  // Enhanced patent details view
  modalContent.innerHTML = `
    <div class="grid grid-cols-1 gap-6">
      <div class="bg-blue-50 dark:bg-blue-900 rounded-lg p-4">
        <div class="mb-2">
          <span class="px-2 py-1 inline-flex text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200">
            Patent No. ${patent.patentNumber || 'Unknown'}
          </span>
          ${patent.date ? `
            <span class="px-2 py-1 ml-2 inline-flex text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200">
              Filed: ${this.formatDate(patent.date)}
            </span>
          ` : ''}
        </div>
        
        <h3 class="font-medium text-lg text-blue-900 dark:text-blue-100">
          ${patent.title || 'Untitled Patent'}
        </h3>
        
        <div class="text-sm text-blue-800 dark:text-blue-200 mt-1">
          <span class="font-semibold">Assignee:</span> ${patent.assignee || 'Unknown'}
        </div>
      </div>
      
      <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Abstract</h4>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          ${patent.abstract || 'No abstract available'}
        </p>
      </div>
      
      ${patent.claims ? `
        <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Claims</h4>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            ${this.formatPatentClaims(patent.claims)}
          </div>
        </div>
      ` : ''}
      
      <div class="mt-6 flex justify-end space-x-3">
        <a href="https://patents.google.com/patent/US${patent.patentNumber?.replace(/[^\d]/g, '')}" 
           target="_blank" 
           class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm transition-colors">
           View on Google Patents
        </a>
      </div>
    </div>
  `;
  
  // Show modal
  modal.classList.remove('hidden');
},

// Format patent claims for display
formatPatentClaims(claims) {
  if (!claims) return '<p>No claims available</p>';
  
  // Check if claims is already an array
  if (Array.isArray(claims)) {
    return claims.map((claim, index) => `
      <div class="mb-2">
        <span class="font-medium">${index + 1}.</span> ${claim}
      </div>
    `).join('');
  }
  
  // If claims is a string, try to split it into numbered claims
  const claimsList = claims.split(/\s*\d+\.\s+/).filter(Boolean);
  
  if (claimsList.length > 1) {
    return claimsList.map((claim, index) => `
      <div class="mb-2">
        <span class="font-medium">${index + 1}.</span> ${claim}
      </div>
    `).join('');
  }
  
  // If all else fails, just return the text
  return `<p>${claims}</p>`;
},
    

    async fetchMarketData(competitorName) {
        try {
            const response = await fetch(`${API_BASE_URL}/market/data?company=${encodeURIComponent(competitorName)}`);
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            const data = await response.json();
            if (!data.success) {
                throw new Error('Failed to fetch market data');
            }
            return data.data;
        } catch (error) {
            console.error('Error fetching market data:', error);
            throw error;
        }
    },

    // Refresh Market data tab
    async refreshMarketData() {
        const marketLoading = document.getElementById('market-loading');
        const marketError = document.getElementById('market-error');
        const marketContent = document.getElementById('market-content');

        marketLoading.classList.remove('hidden');
        marketError.classList.add('hidden');
        marketContent.classList.add('hidden');

        try {
            const marketData = await this.fetchMarketData(this.competitorData.name);
            this.competitorData.marketData = marketData;
            this.renderMarketData();
            marketLoading.classList.add('hidden');
            marketContent.classList.remove('hidden');
        } catch (error) {
            marketLoading.classList.add('hidden');
            marketError.classList.remove('hidden');
            marketError.querySelector('.error-text').textContent = error.message;
        }
    },

    // Updated Market Data Section
renderMarketData() {
    if (!this.competitorData.marketData) {
      console.warn('Market data not yet loaded');
      return;
    }
    
    if (this.competitorData.type === 'device') {
      this.renderDeviceMarketData();

    } else if (this.competitorData.type === 'drug') {
      this.renderDrugMarketData();
            
    } else {
      this.renderEarlyStageMarketData();

    }



  
    // Add data quality indicator for any data source
    this.addDataQualityIndicator();
  },
  
  // Add data quality indicator to show simulated vs real data
  addDataQualityIndicator() {
    const marketContent = document.getElementById('market-content');
    if (!marketContent) return;
    
    // Remove existing indicator if present
    const existingIndicator = document.getElementById('data-quality-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }
    
    // Check if we have data quality information
    let hasSimulatedData = false;
    let simulatedYears = [];
    let realDataYears = [];
    
    if (this.competitorData.type === 'device' && 
        this.competitorData.marketData.partB && 
        this.competitorData.marketData.partB.dataQuality) {
      hasSimulatedData = this.competitorData.marketData.partB.dataQuality.simulatedYears.length > 0;
      simulatedYears = this.competitorData.marketData.partB.dataQuality.simulatedYears;
      realDataYears = this.competitorData.marketData.partB.dataQuality.realDataYears;
    } else if (this.competitorData.type === 'drug' && 
              this.competitorData.marketData.partD && 
              this.competitorData.marketData.partD.dataQuality) {
      hasSimulatedData = this.competitorData.marketData.partD.dataQuality.simulatedYears.length > 0;
      simulatedYears = this.competitorData.marketData.partD.dataQuality.simulatedYears;
      realDataYears = this.competitorData.marketData.partD.dataQuality.realDataYears;
    }
    
    if (hasSimulatedData) {
      const indicator = document.createElement('div');
      indicator.id = 'data-quality-indicator';
      indicator.className = 'mb-4 bg-blue-50 dark:bg-blue-900 rounded-lg p-4 text-sm';
      indicator.innerHTML = `
        <div class="flex items-start">
          <div class="flex-shrink-0">
            <i class="fas fa-info-circle text-blue-600 dark:text-blue-400 mt-0.5"></i>
          </div>
          <div class="ml-3">
            <h3 class="font-medium text-blue-800 dark:text-blue-300">Data Source Information</h3>
            <div class="mt-2 text-blue-700 dark:text-blue-200">
              <p class="mb-1">This visualization includes both real and projected data:</p>
              <ul class="list-disc pl-5 space-y-1 mt-1">
                <li><span class="font-medium">Real data years:</span> ${realDataYears.sort().join(', ')}</li>
                <li><span class="font-medium">Simulated data years:</span> ${simulatedYears.sort().join(', ')}</li>
              </ul>
              <p class="mt-2">Simulated data is based on industry-standard growth rates and historical trends.</p>
            </div>
          </div>
        </div>
      `;
      
      // Insert at the beginning of the market content
      marketContent.insertBefore(indicator, marketContent.firstChild);
    }
  },
  
  // Render device market data with improved display
  renderDeviceMarketData() {
    document.getElementById('device-market-section').classList.remove('hidden');
    document.getElementById('drug-market-section').classList.add('hidden');
    document.getElementById('early-stage-market-section').classList.add('hidden');
  
    const marketData = this.competitorData.marketData;
    const partB = marketData.partB || {};
    this.logData('Device Market Data', marketData);
  
    // Enhanced metrics with data source tags
    document.getElementById('cpt-codes').innerHTML = this.formatCptCodes(marketData.cptCodes);
    document.getElementById('total-implantations').textContent = this.formatNumber(partB.totalImplantations);
    document.getElementById('avg-reimbursement').textContent = `$${this.formatNumber(parseFloat(partB.avgReimbursement || 0), 2)}`;
    
    // Add data source indicators to growth metrics
    if (partB.yearlyTrends) {
      const latestYear = Object.keys(partB.yearlyTrends).sort().pop();
      if (latestYear && partB.yearlyTrends[latestYear]) {
        const isSimulated = partB.dataQuality && 
                            partB.dataQuality.simulatedYears && 
                            partB.dataQuality.simulatedYears.includes(parseInt(latestYear));
        
        const yoyElement = document.getElementById('yoy-growth');
        yoyElement.textContent = partB.yoyGrowth?.implantations || 'N/A';
        
        if (isSimulated) {
          yoyElement.innerHTML += ' <span class="text-xs text-blue-500 dark:text-blue-400">(projected)</span>';
        }
      }
    }
    
    document.getElementById('market-share-device') && 
      (document.getElementById('market-share-device').textContent = partB.marketShare || '0%');
    document.getElementById('cagr-device') && 
      (document.getElementById('cagr-device').textContent = partB.cagr || 'N/A');


      document.getElementById('market-share').textContent = 
      partB.marketShare || 'Unknown';

  document.getElementById('revenue').textContent = this.formatNumber(partB.totalImplantations);
      // summary.marketMetrics?.totalSpending ? 
      // `${Number(summary.marketMetrics.totalSpending).toLocaleString()}` : 
      // 'Unknown';


  document.getElementById('growth-rate').textContent =  `$${this.formatNumber(parseFloat(partB.avgReimbursement || 0), 2)}`;
      // summary.marketMetrics?.growthRate || 'Unknown';


  document.getElementById('medicare-claims').textContent =  partB.yoyGrowth?.implantations || 'N/A';
      // summary.marketMetrics?.totalImplantations ? 
      // Number(summary.marketMetrics.totalImplantations).toLocaleString() : 
      // 'Unknown';


  
    // Charts
    this.renderDeviceTrendsChart(partB);
    this.renderDeviceCompanyComparisonChart(marketData.companyComparisons);
  
    // Enhanced table with data source indicators and pagination
    this.renderDeviceDataTable(partB, marketData.companyComparisons);
  },
  
  // Format CPT codes with descriptions
  formatCptCodes(cptCodes) {
    if (!cptCodes || cptCodes.length === 0) return 'Unknown';
    
    // CPT code descriptions
    const cptDescriptions = {
      '64568': 'Incision for implantation of cranial nerve (eg, vagus nerve) neurostimulator electrode array',
      '61885': 'Insertion of neurostimulator pulse generator',
      '61863': 'Twist drill, burr hole, craniotomy for stereotactic implantation of neurostimulator array',
      '61864': 'Neurostimulator array insertion',
      '61886': 'Insertion of cranial neurostimulator pulse generator',
      '61850': 'Twist drill/burr hole for implant of neurostimulator electrodes',
      '61860': 'Craniotomy for implant of neurostimulator electrodes',
      '61889': 'Revision/removal of cranial neurostimulator pulse generator'
    };
    
    return cptCodes.map(code => {
      const description = cptDescriptions[code] ? 
        `<span class="block text-xs text-gray-500 dark:text-gray-400 mt-1">${cptDescriptions[code]}</span>` : '';
      return `<span class="font-medium">${code}</span>${description}`;
    }).join(', ');
  },
  
  // Format numbers with commas
  formatNumber(number, decimals = 0) {
    if (number === undefined || number === null) return '0';
    
    // Convert to number if it's a string
    const num = typeof number === 'string' ? parseFloat(number) : number;
    
    // Format with commas and specified decimals
    return num.toLocaleString(undefined, { 
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  },
  
  // Device Trends Chart with data source indicators
  renderDeviceTrendsChart(partB) {
    if (this.charts.deviceTrends) {
      this.charts.deviceTrends.destroy();
    }
    const ctx = document.getElementById('device-trends-chart')?.getContext('2d');
    if (!ctx) return;
  
    const years = Object.keys(partB.yearlyTrends || {}).sort();
    const implantations = years.map(year => partB.yearlyTrends[year].implantations);
    const payments = years.map(year => partB.yearlyTrends[year].payment);
    
    // Determine which years are simulated
    const simulatedYears = partB.dataQuality?.simulatedYears || [];
    
    // Custom dataset that shows simulated years differently
    this.charts.deviceTrends = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          {
            label: 'Implantations',
            data: implantations,
            borderColor: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            segment: {
              borderDash: ctx => {
                // Make simulated years' segments dashed
                const yearIdx = parseInt(ctx.p1.parsed.x);
                const year = years[yearIdx];
                return simulatedYears.includes(parseInt(year)) ? [6, 6] : undefined;
              }
            },
            yAxisID: 'y',
            tension: 0.3
          },
          {
            label: 'Total Payment ($)',
            data: payments,
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            segment: {
              borderDash: ctx => {
                // Make simulated years' segments dashed
                const yearIdx = parseInt(ctx.p1.parsed.x);
                const year = years[yearIdx];
                return simulatedYears.includes(parseInt(year)) ? [6, 6] : undefined;
              }
            },
            yAxisID: 'y1',
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Implantations' },
            beginAtZero: true
          },
          y1: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Total Payment ($)' },
            beginAtZero: true,
            grid: { drawOnChartArea: false }
          },
          x: { title: { display: true, text: 'Year' } }
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (context) => {
                const year = context.label;
                const isSimulated = simulatedYears.includes(parseInt(year));
                const valueLabel = `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`;
                return isSimulated ? [valueLabel, '(Projected data)'] : valueLabel;
              }
            }
          }
        }
      }
    });
  },
  
  // Device Company Comparison Chart with improved tooltips
  renderDeviceCompanyComparisonChart(comparisons) {
    if (this.charts.deviceComparison) {
      this.charts.deviceComparison.destroy();
    }
    const ctx = document.getElementById('device-comparison-chart')?.getContext('2d');
    if (!ctx) return;
  
    // Add null check for comparisons
    if (!comparisons || typeof comparisons !== 'object') {
      console.warn('No company comparison data available');
      // Render empty chart or message
      return;
    }
  
    const companies = Object.keys(comparisons).filter(c => comparisons[c].partB);
    const implantations = companies.map(c => comparisons[c].partB?.totalImplantations || 0);
    
    // Format to millions for readability in the chart
    const implantationsInMillions = implantations.map(val => val / 1000000);
  
    this.charts.deviceComparison = new Chart(ctx, {
      // rest of the chart configuration remains the same
    });
  },
  
  // Enhanced Device Data Table with pagination, search, and data source indicators
  renderDeviceDataTable(partB, comparisons) {
    const tableBody = document.getElementById('cms-part-b-table-body');
    if (!tableBody) return;
  
    const yearlyTrends = partB.yearlyTrends || {};
    const simulatedYears = partB.dataQuality?.simulatedYears || [];
    
    // Convert to array and sort by year (newest first)
    const rows = Object.entries(yearlyTrends)
      .map(([year, data]) => ({
        year,
        implantations: data.implantations,
        payment: data.payment,
        avgReimbursement: data.avgReimbursement,
        growthImplantations: data.growth?.implantations || 'N/A',
        growthPayment: data.growth?.payment || 'N/A',
        dataSource: data.dataSource || 'unknown'
      }))
      .sort((a, b) => b.year - a.year); // Newest years first
  
    const state = this.marketPageState.device;
    const start = (state.current - 1) * state.size;
    const paginatedRows = rows.slice(start, start + state.size);
  
    tableBody.innerHTML = paginatedRows.length > 0 ? paginatedRows.map(row => {
      const isSimulated = simulatedYears.includes(parseInt(row.year)) || row.dataSource === 'simulated';
      const dataSourceTag = isSimulated ? 
        '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">Projected</span>' : 
        '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">Real data</span>';
      
      return `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <div class="flex items-center space-x-2">
              <span class="font-medium text-gray-900 dark:text-white">${row.year}</span>
              ${dataSourceTag}
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${this.formatNumber(row.implantations)}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">$${this.formatNumber(row.payment, 2)}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">$${row.avgReimbursement}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <span class="${this.getGrowthColor(row.growthImplantations)}">${row.growthImplantations}</span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <span class="${this.getGrowthColor(row.growthPayment)}">${row.growthPayment}</span>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr><td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">No data available</td></tr>
    `;
  
    this.updatePaginationUI('device', rows.length, state.current);
    this.setupTableSearch('cms-part-b-search', tableBody);
    this.setupPaginationHandlers('device', rows.length);
  },
  
  // Color-code growth rates
  getGrowthColor(growthText) {
    if (growthText === 'N/A') return 'text-gray-500 dark:text-gray-400';
    
    const growth = parseFloat(growthText);
    if (isNaN(growth)) return 'text-gray-500 dark:text-gray-400';
    
    if (growth > 0) return 'text-green-600 dark:text-green-400';
    if (growth < 0) return 'text-red-600 dark:text-red-400';
    return 'text-gray-600 dark:text-gray-400';
  },
  
  // Drug Data rendering with similar improvements
  renderDrugMarketData() {
    document.getElementById('device-market-section').classList.add('hidden');
    document.getElementById('drug-market-section').classList.remove('hidden');
    document.getElementById('early-stage-market-section').classList.add('hidden');
  
    const marketData = this.competitorData.marketData;
    const partD = marketData.partD || {};
    this.logData('Drug Market Data', marketData);
  
    // Enhanced metrics with data source tags
    document.getElementById('total-claims').textContent = this.formatNumber(partD.totalClaims);
    document.getElementById('total-spending').textContent = `$${this.formatNumber(partD.totalSpending)}`;
    document.getElementById('avg-cost-per-claim').textContent = `$${this.formatNumber(parseFloat(partD.avgCostPerClaim || 0), 2)}`;


    // Drug metrics
    document.getElementById('market-share').textContent = partD.marketShare
    // summary.marketMetrics?.marketShare || 'Unknown';
    document.getElementById('revenue-head').textContent = `Total Spending`
document.getElementById('revenue').textContent = `$${this.formatNumber(partD.totalSpending)}`;
    // summary.marketMetrics?.totalSpending ? 
    // `${Number(summary.marketMetrics.totalSpending).toLocaleString()}` : 
    // 'Unknown';
document.getElementById('growth-rate').textContent = `$${this.formatNumber(parseFloat(partD.avgCostPerClaim || 0), 2)}`;
    // summary.marketMetrics?.growthRate || 'Unknown';
document.getElementById('medicare-claims').textContent = partD.cagr || 'N/A';
    // summary.marketMetrics?.totalClaims ? 
    // Number(summary.marketMetrics.totalClaims).toLocaleString() : 
    // 'Unknown';

    
    // Add data source indicators to growth metrics
    if (partD.yearlyTrends) {
      const latestYear = Object.keys(partD.yearlyTrends).sort().pop();
      if (latestYear && partD.yearlyTrends[latestYear]) {
        const isSimulated = partD.dataQuality && 
                           partD.dataQuality.simulatedYears && 
                           partD.dataQuality.simulatedYears.includes(parseInt(latestYear));
        
        const cagr = document.getElementById('cagr-drug');
        if (cagr) {
          cagr.textContent = partD.cagr || 'N/A';
          if (isSimulated) {
            cagr.innerHTML += ' <span class="text-xs text-blue-500 dark:text-blue-400">(projected)</span>';
          }
        }
      }
    }
    
    document.getElementById('market-share-drug') && 
      (document.getElementById('market-share-drug').textContent = partD.marketShare || '0%');
    
    // Product status from Orange Book data
    const hasOrangeBookData = this.competitorData.orangeBook && 
                             this.competitorData.orangeBook.products && 
                             this.competitorData.orangeBook.products.length > 0;
    
    document.getElementById('product-status').textContent = hasOrangeBookData ? 'Active' : 'Unknown';
  
    // Charts with similar enhancements
    this.renderDrugTrendsChart(partD);
    this.renderDrugCompanyComparisonChart(marketData.companyComparisons);
  
    // Enhanced table with data source indicators and pagination
    this.renderDrugDataTable(partD, marketData.companyComparisons);
  },
  
  // Drug Trends Chart with data source indicators
  renderDrugTrendsChart(partD) {
    if (this.charts.drugTrends) {
      this.charts.drugTrends.destroy();
    }
    const ctx = document.getElementById('drug-trends-chart')?.getContext('2d');
    if (!ctx) return;
  
    const years = Object.keys(partD.yearlyTrends || {}).sort();
    const spending = years.map(year => partD.yearlyTrends[year].spending);
    const claims = years.map(year => partD.yearlyTrends[year].claims);
    
    // Determine which years are simulated
    const simulatedYears = partD.dataQuality?.simulatedYears || [];
    
    // Convert spending to millions for readability
    const spendingInMillions = spending.map(val => val / 1000000);
    
    this.charts.drugTrends = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          {
            label: 'Total Spending ($ Millions)',
            data: spendingInMillions,
            backgroundColor: ctx => {
              const yearIdx = ctx.dataIndex;
              const year = years[yearIdx];
              // Use different colors for simulated years
              return simulatedYears.includes(parseInt(year)) ? 
                'rgba(59, 130, 246, 0.4)' : 'rgba(59, 130, 246, 0.7)';
            },
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Total Claims',
            data: claims,
            type: 'line',
            borderColor: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            segment: {
              borderDash: ctx => {
                // Make simulated years' segments dashed
                const yearIdx = parseInt(ctx.p1.parsed.x);
                const year = years[yearIdx];
                return simulatedYears.includes(parseInt(year)) ? [6, 6] : undefined;
              }
            },
            yAxisID: 'y1',
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Total Spending ($ Millions)' },
            beginAtZero: true
          },
          y1: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Total Claims' },
            beginAtZero: true,
            grid: { drawOnChartArea: false }
          },
          x: { title: { display: true, text: 'Year' } }
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (context) => {
                const year = context.label;
                const isSimulated = simulatedYears.includes(parseInt(year));
                let valueLabel;
                
                if (context.dataset.label.includes('Spending')) {
                  // Convert back to actual dollars
                  const actualValue = context.parsed.y * 1000000;
                  valueLabel = `Total Spending: $${actualValue.toLocaleString()}`;
                } else {
                  valueLabel = `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`;
                }
                
                return isSimulated ? [valueLabel, '(Projected data)'] : valueLabel;
              }
            }
          }
        }
      }
    });
  },
  
  // Drug Company Comparison Chart with improved tooltips
  renderDrugCompanyComparisonChart(comparisons) {
    if (this.charts.drugComparison) {
      this.charts.drugComparison.destroy();
    }
    const ctx = document.getElementById('drug-comparison-chart')?.getContext('2d');
    if (!ctx) return;
  
    const companies = Object.keys(comparisons).filter(c => comparisons[c].partD);
    const spending = companies.map(c => comparisons[c].partD?.totalSpending || 0);
    
    // Format to millions for readability
    const spendingInMillions = spending.map(val => val / 1000000);
  
    this.charts.drugComparison = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: companies,
        datasets: [
          {
            label: 'Total Spending ($ Millions)',
            data: spendingInMillions,
            backgroundColor: [
              'rgba(59, 130, 246, 0.7)',  // Main color
              'rgba(16, 185, 129, 0.7)',  // Alternate 1
              'rgba(249, 115, 22, 0.7)',  // Alternate 2
              'rgba(139, 92, 246, 0.7)'   // Alternate 3
            ],
            borderWidth: 0,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',  // Horizontal bar chart for better readability
        scales: {
          x: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Total Spending ($ Millions)'
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                // Convert back to actual dollars
                const actualValue = context.parsed.x * 1000000;
                return `Total Spending: $${actualValue.toLocaleString()}`;
              }
            }
          }
        }
      }
    });
  },
  
  // Enhanced Drug Data Table with pagination, search, and data source indicators
  renderDrugDataTable(partD, comparisons) {
    const tableBody = document.getElementById('cms-part-d-table-body');
    if (!tableBody) return;
  
    const yearlyTrends = partD.yearlyTrends || {};
    const simulatedYears = partD.dataQuality?.simulatedYears || [];
    
    // Convert to array and sort by year (newest first)
    const rows = Object.entries(yearlyTrends)
      .map(([year, data]) => ({
        year,
        spending: data.spending,
        claims: data.claims,
        avgCostPerClaim: data.avgCostPerClaim,
        growthSpending: data.growth?.spending || 'N/A',
        growthClaims: data.growth?.claims || 'N/A',
        dataSource: data.dataSource || 'unknown'
      }))
      .sort((a, b) => b.year - a.year); // Newest years first
  
    const state = this.marketPageState.drug;
    const start = (state.current - 1) * state.size;
    const paginatedRows = rows.slice(start, start + state.size);
  
    tableBody.innerHTML = paginatedRows.length > 0 ? paginatedRows.map(row => {
      const isSimulated = simulatedYears.includes(parseInt(row.year)) || row.dataSource === 'simulated';
      const dataSourceTag = isSimulated ? 
        '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">Projected</span>' : 
        '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">Real data</span>';
      
      return `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <div class="flex items-center space-x-2">
              <span class="font-medium text-gray-900 dark:text-white">${row.year}</span>
              ${dataSourceTag}
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">$${this.formatNumber(row.spending)}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${this.formatNumber(row.claims)}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">$${row.avgCostPerClaim}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <span class="${this.getGrowthColor(row.growthSpending)}">${row.growthSpending}</span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            <span class="${this.getGrowthColor(row.growthClaims)}">${row.growthClaims}</span>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr><td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">No data available</td></tr>
    `;
  
    this.updatePaginationUI('drug', rows.length, state.current);
    this.setupTableSearch('cms-part-d-search', tableBody);
    this.setupPaginationHandlers('drug', rows.length);
  },

    // Render Market data tab
//     renderMarketData() {
//         if (!this.competitorData.marketData) {
//             console.warn('Market data not yet loaded');
//             return;
//         }
//         if (this.competitorData.type === 'device') {
//             this.renderDeviceMarketData();
//         } else if (this.competitorData.type === 'drug') {
//             this.renderDrugMarketData();
//         } else {
//             this.renderEarlyStageMarketData();
//         }
//     },

//     // Render device market data
//     async renderDeviceMarketData() {
//         document.getElementById('device-market-section').classList.remove('hidden');
//         document.getElementById('drug-market-section').classList.add('hidden');
//         document.getElementById('early-stage-market-section').classList.add('hidden');

//         const marketData = this.competitorData.marketData;
//         const partB = marketData.partB || {};
//         this.logData('Device Market Data', marketData);

//         // Metrics
//         document.getElementById('cpt-codes').textContent = marketData.cptCodes?.join(', ') || 'Unknown';
//         document.getElementById('total-implantations').textContent = partB.totalImplantations?.toLocaleString() || '0';
//         document.getElementById('avg-reimbursement').textContent = `$${parseFloat(partB.avgReimbursement || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
//         document.getElementById('yoy-growth').textContent = partB.yoyGrowth?.implantations || 'N/A';
//         document.getElementById('market-share-device') && (document.getElementById('market-share-device').textContent = partB.marketShare || '0%');
//         document.getElementById('cagr-device') && (document.getElementById('cagr-device').textContent = partB.cagr || 'N/A');

//         // Charts
//         this.renderDeviceTrendsChart(partB);
//         this.renderDeviceCompanyComparisonChart(marketData.companyComparisons);

//         // Table with Pagination
//         this.renderDeviceDataTable(partB, marketData.companyComparisons);
//     },

//     // Render drug market data
//     async renderDrugMarketData() {
//         document.getElementById('device-market-section').classList.add('hidden');
//         document.getElementById('drug-market-section').classList.remove('hidden');
//         document.getElementById('early-stage-market-section').classList.add('hidden');

//         const marketData = this.competitorData.marketData;
//         const partD = marketData.partD || {};
//         this.logData('Drug Market Data', marketData);

//         // Metrics
//         document.getElementById('total-claims').textContent = partD.totalClaims?.toLocaleString() || '0';
//         document.getElementById('total-spending').textContent = `$${partD.totalSpending?.toLocaleString() || '0'}`;
//         document.getElementById('avg-cost-per-claim').textContent = `$${parseFloat(partD.avgCostPerClaim || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
//         document.getElementById('market-share-drug') && (document.getElementById('market-share-drug').textContent = partD.marketShare || '0%');
//         document.getElementById('cagr-drug') && (document.getElementById('cagr-drug').textContent = partD.cagr || 'N/A');
//         document.getElementById('product-status').textContent = this.competitorData.orangeBook?.products?.length > 0 ? 'Active' : 'Unknown';

//         // Charts
//         this.renderDrugTrendsChart(partD);
//         this.renderDrugCompanyComparisonChart(marketData.companyComparisons);

//         // Table with Pagination
//         this.renderDrugDataTable(partD, marketData.companyComparisons);
//     },

//     // Render early-stage market data
    renderEarlyStageMarketData() {
        document.getElementById('device-market-section').classList.add('hidden');
        document.getElementById('drug-market-section').classList.add('hidden');
        document.getElementById('early-stage-market-section').classList.remove('hidden');

        document.getElementById('development-stage').textContent = 'Research & Development';
        document.getElementById('funding-info').textContent = 'Unknown';
        document.getElementById('threat-level').textContent = 'Medium';

        document.getElementById('market-share').textContent = 'Pre-market';
        document.getElementById('revenue').textContent = 'Pre-revenue';
        document.getElementById('growth-rate').textContent = 'N/A';
        document.getElementById('medicare-claims').textContent = 'N/A';
    },

//     // Device Trends Chart
//     renderDeviceTrendsChart(partB) {
//         if (this.charts.deviceTrends) {
//             this.charts.deviceTrends.destroy();
//         }
//         const ctx = document.getElementById('device-trends-chart')?.getContext('2d');
//         if (!ctx) return;

//         const years = Object.keys(partB.yearlyTrends || {}).sort();
//         const implantations = years.map(year => partB.yearlyTrends[year].implantations);
//         const payments = years.map(year => partB.yearlyTrends[year].payment);

//         this.charts.deviceTrends = new Chart(ctx, {
//             type: 'line',
//             data: {
//                 labels: years,
//                 datasets: [
//                     {
//                         label: 'Implantations',
//                         data: implantations,
//                         borderColor: '#10B981',
//                         backgroundColor: 'rgba(16, 185, 129, 0.2)',
//                         yAxisID: 'y',
//                         tension: 0.3
//                     },
//                     {
//                         label: 'Total Payment ($)',
//                         data: payments,
//                         borderColor: '#3B82F6',
//                         backgroundColor: 'rgba(59, 130, 246, 0.2)',
//                         yAxisID: 'y1',
//                         tension: 0.3
//                     }
//                 ]
//             },
//             options: {
//                 responsive: true,
//                 maintainAspectRatio: false,
//                 scales: {
//                     y: {
//                         type: 'linear',
//                         position: 'left',
//                         title: { display: true, text: 'Implantations' },
//                         beginAtZero: true
//                     },
//                     y1: {
//                         type: 'linear',
//                         position: 'right',
//                         title: { display: true, text: 'Total Payment ($)' },
//                         beginAtZero: true,
//                         grid: { drawOnChartArea: false }
//                     },
//                     x: { title: { display: true, text: 'Year' } }
//                 },
//                 plugins: {
//                     legend: { position: 'top' },
//                     tooltip: {
//                         callbacks: {
//                             label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`
//                         }
//                     }
//                 }
//             }
//         });
//     },

//     // Device Company Comparison Chart
//     renderDeviceCompanyComparisonChart(comparisons) {
//         if (this.charts.deviceComparison) {
//             this.charts.deviceComparison.destroy();
//         }
//         const ctx = document.getElementById('device-comparison-chart')?.getContext('2d');
//         if (!ctx) return;

//         const companies = Object.keys(comparisons).filter(c => comparisons[c].partB);
//         const implantations = companies.map(c => comparisons[c].partB?.totalImplantations || 0);
//         const payments = companies.map(c => comparisons[c].partB?.totalPayment || 0);

//         this.charts.deviceComparison = new Chart(ctx, {
//             type: 'bar',
//             data: {
//                 labels: companies,
//                 datasets: [
//                     {
//                         label: 'Total Implantations',
//                         data: implantations,
//                         backgroundColor: 'rgba(16, 185, 129, 0.6)',
//                         borderColor: '#10B981',
//                         borderWidth: 1
//                     },
//                     {
//                         label: 'Total Payment ($)',
//                         data: payments,
//                         backgroundColor: 'rgba(59, 130, 246, 0.6)',
//                         borderColor: '#3B82F6',
//                         borderWidth: 1
//                     }
//                 ]
//             },
//             options: {
//                 responsive: true,
//                 maintainAspectRatio: false,
//                 scales: {
//                     y: { beginAtZero: true, title: { display: true, text: 'Value' } },
//                     x: { title: { display: true, text: 'Company' } }
//                 },
//                 plugins: {
//                     legend: { position: 'top' },
//                     tooltip: {
//  gestation: {
//                             callbacks: {
//                                 label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`
//                             }
//                         }
//                     }
//                 }
//             }
//         })
//     },

//         // Drug Trends Chart
//         renderDrugTrendsChart(partD) {
//             if (this.charts.drugTrends) {
//                 this.charts.drugTrends.destroy();
//             }
//             const ctx = document.getElementById('drug-trends-chart')?.getContext('2d');
//             if (!ctx) return;

//             const years = Object.keys(partD.yearlyTrends || {}).sort();
//             const spending = years.map(year => partD.yearlyTrends[year].spending);
//             const claims = years.map(year => partD.yearlyTrends[year].claims);

//             this.charts.drugTrends = new Chart(ctx, {
//                 type: 'bar',
//                 data: {
//                     labels: years,
//                     datasets: [
//                         {
//                             label: 'Total Spending ($)',
//                             data: spending,
//                             backgroundColor: 'rgba(59, 130, 246, 0.6)',
//                             borderColor: '#3B82F6',
//                             borderWidth: 1,
//                             yAxisID: 'y'
//                         },
//                         {
//                             label: 'Total Claims',
//                             data: claims,
//                             type: 'line',
//                             borderColor: '#10B981',
//                             backgroundColor: 'rgba(16, 185, 129, 0.2)',
//                             yAxisID: 'y1',
//                             tension: 0.3
//                         }
//                     ]
//                 },
//                 options: {
//                     responsive: true,
//                     maintainAspectRatio: false,
//                     scales: {
//                         y: {
//                             type: 'linear',
//                             position: 'left',
//                             title: { display: true, text: 'Total Spending ($)' },
//                             beginAtZero: true
//                         },
//                         y1: {
//                             type: 'linear',
//                             position: 'right',
//                             title: { display: true, text: 'Total Claims' },
//                             beginAtZero: true,
//                             grid: { drawOnChartArea: false }
//                         },
//                         x: { title: { display: true, text: 'Year' } }
//                     },
//                     plugins: {
//                         legend: { position: 'top' },
//                         tooltip: {
//                             callbacks: {
//                                 label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`
//                             }
//                         }
//                     }
//                 }
//             });
//         },

//         // Drug Company Comparison Chart
//         renderDrugCompanyComparisonChart(comparisons) {
//             if (this.charts.drugComparison) {
//                 this.charts.drugComparison.destroy();
//             }
//             const ctx = document.getElementById('drug-comparison-chart')?.getContext('2d');
//             if (!ctx) return;

//             const companies = Object.keys(comparisons).filter(c => comparisons[c].partD);
//             const spending = companies.map(c => comparisons[c].partD?.totalSpending || 0);
//             const claims = companies.map(c => comparisons[c].partD?.totalClaims || 0);

//             this.charts.drugComparison = new Chart(ctx, {
//                 type: 'bar',
//                 data: {
//                     labels: companies,
//                     datasets: [
//                         {
//                             label: 'Total Spending ($)',
//                             data: spending,
//                             backgroundColor: 'rgba(59, 130, 246, 0.6)',
//                             borderColor: '#3B82F6',
//                             borderWidth: 1
//                         },
//                         {
//                             label: 'Total Claims',
//                             data: claims,
//                             backgroundColor: 'rgba(16, 185, 129, 0.6)',
//                             borderColor: '#10B981',
//                             borderWidth: 1
//                         }
//                     ]
//                 },
//                 options: {
//                     responsive: true,
//                     maintainAspectRatio: false,
//                     scales: {
//                         y: { beginAtZero: true, title: { display: true, text: 'Value' } },
//                         x: { title: { display: true, text: 'Company' } }
//                     },
//                     plugins: {
//                         legend: { position: 'top' },
//                         tooltip: {
//                             callbacks: {
//                                 label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`
//                             }
//                         }
//                     }
//                 }
//             });
//         },

//         // Device Data Table with Pagination and Search
//         renderDeviceDataTable(partB, comparisons) {
//             const tableBody = document.getElementById('cms-part-b-table-body');
//             if (!tableBody) return;
        
//             const yearlyTrends = partB.yearlyTrends || {};
//             const rows = Object.entries(yearlyTrends).flatMap(([year, data]) =>
//                 Object.keys(data).includes('implantations') ? [{
//                     year,
//                     implantations: data.implantations,
//                     payment: data.payment,
//                     avgReimbursement: data.avgReimbursement,
//                     growthImplantations: data.growth?.implantations || 'N/A',
//                     growthPayment: data.growth?.payment || 'N/A'
//                 }] : []
//             );
        
//             const state = this.marketPageState.device; // Line 1989: Error here
//             const start = (state.current - 1) * state.size;
//             const paginatedRows = rows.slice(start, start + state.size);

//             tableBody.innerHTML = paginatedRows.length > 0 ? paginatedRows.map(row => `
//                 <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row.year}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row.implantations.toLocaleString()}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">$${row.payment.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">$${row.avgReimbursement}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row.growthImplantations}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row.growthPayment}</td>
//                 </tr>
//             `).join('') : `
//                 <tr><td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">No data available</td></tr>
//             `;

//             this.updatePaginationUI('device', rows.length, state.current);
//             this.setupTableSearch('cms-part-b-search', tableBody, ['year', 'implantations', 'payment']);
//             this.setupPaginationHandlers('device', rows.length);
//         },

//         // Drug Data Table with Pagination and Search
//         renderDrugDataTable(partD, comparisons) {
//             const tableBody = document.getElementById('cms-part-d-table-body');
//             if (!tableBody) return;

//             const yearlyTrends = partD.yearlyTrends || {};
//             const rows = Object.entries(yearlyTrends).flatMap(([year, data]) =>
//                 Object.keys(data).includes('spending') ? [{
//                     year,
//                     spending: data.spending,
//                     claims: data.claims,
//                     avgCostPerClaim: data.avgCostPerClaim,
//                     growthSpending: data.growth?.spending || 'N/A',
//                     growthClaims: data.growth?.claims || 'N/A'
//                 }] : []
//             );

//             const state = this.marketPageState.drug;
//             const start = (state.current - 1) * state.size;
//             const paginatedRows = rows.slice(start, start + state.size);

//             tableBody.innerHTML = paginatedRows.length > 0 ? paginatedRows.map(row => `
//                 <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row.year}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">$${row.spending.toLocaleString()}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row.claims.toLocaleString()}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">$${row.avgCostPerClaim}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row.growthSpending}</td>
//                     <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row.growthClaims}</td>
//                 </tr>
//             `).join('') : `
//                 <tr><td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">No data available</td></tr>
//             `;

//             this.updatePaginationUI('drug', rows.length, state.current);
//             this.setupTableSearch('cms-part-d-search', tableBody, ['year', 'spending', 'claims']);
//             this.setupPaginationHandlers('drug', rows.length);
//         },

//         // Pagination UI Update
        updatePaginationUI(type, total, currentPage) {
            const state = this.marketPageState[type];
            const totalPages = Math.ceil(total / state.size);
            const prefix = type === 'device' ? 'cms-part-b' : 'cms-part-d';

            document.getElementById(`${prefix}-page-start`).textContent = ((currentPage - 1) * state.size) + 1;
            document.getElementById(`${prefix}-page-end`).textContent = Math.min(currentPage * state.size, total);
            document.getElementById(`${prefix}-total`).textContent = total;

            const prevButton = document.getElementById(`${prefix}-prev-page`);
            const nextButton = document.getElementById(`${prefix}-next-page`);
            prevButton.disabled = currentPage === 1;
            prevButton.classList.toggle('opacity-50', currentPage === 1);
            nextButton.disabled = currentPage >= totalPages;
            nextButton.classList.toggle('opacity-50', currentPage >= totalPages);
        },

        // Table Search Setup
        setupTableSearch(searchId, tableBody, searchableFields) {
            const searchInput = document.getElementById(searchId);
            if (!searchInput) return;

            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const rows = Array.from(tableBody.getElementsByTagName('tr'));

                rows.forEach(row => {
                    const text = Array.from(row.cells)
                        .map(cell => cell.textContent.toLowerCase())
                        .join(' ');
                    row.style.display = searchTerm ? text.includes(searchTerm) ? '' : 'none' : '';
                });
            });
        },

        // Pagination Handlers
        setupPaginationHandlers(type, totalRows) {
            const prefix = type === 'device' ? 'cms-part-b' : 'cms-part-d';
            const state = this.marketPageState[type];
            const totalPages = Math.ceil(totalRows / state.size);

            document.getElementById(`${prefix}-prev-page`)?.addEventListener('click', () => {
                if (state.current > 1) {
                    state.current--;
                    type === 'device' ? this.renderDeviceDataTable(this.competitorData.marketData.partB, this.competitorData.marketData.companyComparisons) :
                        this.renderDrugDataTable(this.competitorData.marketData.partD, this.competitorData.marketData.companyComparisons);
                }
            });

            document.getElementById(`${prefix}-next-page`)?.addEventListener('click', () => {
                if (state.current < totalPages) {
                    state.current++;
                    type === 'device' ? this.renderDeviceDataTable(this.competitorData.marketData.partB, this.competitorData.marketData.companyComparisons) :
                        this.renderDrugDataTable(this.competitorData.marketData.partD, this.competitorData.marketData.companyComparisons);
                }
            });
        },

  
    // Render SEC data tab
    renderSecData() {
        // Check if we have SEC filings data
        const secFilings = this.competitorData.secFilings || [];
        this.logData('SEC Filings Data for Rendering', secFilings);
        
        // Exit if SEC filings tab is not visible
        if (document.getElementById('sec-filings-tab').classList.contains('hidden')) {
            return;
        }
        
        // Get company information from SEC filings
        let entityInfo = {};
        if (secFilings.length > 0 && secFilings[0].entityInfo) {
            entityInfo = secFilings[0].entityInfo;
        }
        
        // Set company info
        document.getElementById('sec-cik').textContent = entityInfo.cik || this.competitorData.cik || 'Unknown';
        document.getElementById('sec-exchange').textContent = entityInfo.exchanges?.join(', ') || 'Unknown';
        document.getElementById('sec-ticker').textContent = entityInfo.tickers?.join(', ') || 'Unknown';
        document.getElementById('sec-sic').textContent = entityInfo.sic || 'Unknown';
        document.getElementById('sec-sic-desc').textContent = entityInfo.sicDescription || 'Unknown';
        
        // Populate SEC filings table
        const secTableBody = document.getElementById('sec-filings-table-body');
        secTableBody.innerHTML = '';
        
        if (secFilings.length > 0) {
            secFilings.forEach(filing => {
                const row = document.createElement('tr');
                row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
                
                row.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        ${filing.form || 'Unknown'}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        ${filing.description || 'No description available'}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        ${filing.filingDate || 'Unknown'}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        ${filing.reportDate || 'Unknown'}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">
                        <a href="${filing.url || '#'}" target="_blank" class="hover:underline">
                            <i class="fas fa-external-link-alt mr-1"></i> View
                        </a>
                    </td>
                `;
                
                secTableBody.appendChild(row);
            });
        } else {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    No SEC filings data available
                </td>
            `;
            secTableBody.appendChild(row);
        }
    },
    
    // Export competitor report
    exportReport() {
        // Create report content
        let reportContent = `
COMPETITOR REPORT: ${this.competitorData.name}
=====================${Array(this.competitorData.name.length).fill('=').join('')}

Type: ${this.competitorData.type}
Treatment: ${this.competitorData.treatment}
Generated: ${new Date().toLocaleString()}

SUMMARY
-------
`;

        // Add summary data
        const summary = this.competitorData.summary || {};
        if (summary.marketMetrics) {
            reportContent += `Market Metrics:\n`;
            Object.entries(summary.marketMetrics).forEach(([key, value]) => {
                reportContent += `- ${key}: ${value}\n`;
            });
        }
        
        if (summary.fdaStatus) {
            reportContent += `\nFDA Status: ${summary.fdaStatus}\n`;
        }
        
        if (summary.clinicalActivity) {
            reportContent += `\nClinical Activity:\n`;
            Object.entries(summary.clinicalActivity).forEach(([key, value]) => {
                reportContent += `- ${key}: ${value}\n`;
            });
        }
        
        if (summary.intellectualProperty) {
            reportContent += `\nIntellectual Property:\n`;
            Object.entries(summary.intellectualProperty).forEach(([key, value]) => {
                if (typeof value === 'object') {
                    reportContent += `- ${key}:\n`;
                    Object.entries(value).forEach(([subKey, subValue]) => {
                        reportContent += `  - ${subKey}: ${subValue}\n`;
                    });
                } else {
                    reportContent += `- ${key}: ${value}\n`;
                }
            });
        }
        
        // Add FDA data
        const fdaData = this.competitorData.fdaApprovals || { combinedResults: [] };
        reportContent += `\n\nFDA DATA\n--------\n`;
        reportContent += `Total FDA Records: ${fdaData.combinedResults?.length || 0}\n\n`;
        
        if (fdaData.combinedResults && fdaData.combinedResults.length > 0) {
            reportContent += `Recent FDA Activity:\n`;
            fdaData.combinedResults.slice(0, 5).forEach(item => {
                reportContent += `- ${item.name || 'Unknown'} (${item.date || 'Unknown Date'}): ${item.description || 'No description'}\n`;
            });
        } else {
            reportContent += `No FDA data available.\n`;
        }
        
        // Add clinical trials data
        const trialData = this.competitorData.clinicalTrials || [];
        reportContent += `\n\nCLINICAL TRIALS\n--------------\n`;
        reportContent += `Total Trials: ${trialData.length}\n`;
        
        const activeTrials = trialData.filter(t => 
            ['Recruiting', 'Active, not recruiting', 'Not yet recruiting'].includes(t.status)
        ).length;
        
        const completedTrials = trialData.filter(t => t.status === 'Completed').length;
        
        reportContent += `Active Trials: ${activeTrials}\n`;
        reportContent += `Completed Trials: ${completedTrials}\n\n`;
        
        if (trialData.length > 0) {
            reportContent += `Recent Clinical Trials:\n`;
            trialData.slice(0, 5).forEach(trial => {
                reportContent += `- ${trial.title || 'Unknown'} (${trial.status || 'Unknown Status'})\n`;
                reportContent += `  Phase: ${trial.phase || 'Unknown'}, Sponsor: ${trial.sponsor || 'Unknown'}\n`;
                reportContent += `  NCT ID: ${trial.nctId || 'Unknown'}\n\n`;
            });
        } else {
            reportContent += `No clinical trials data available.\n`;
        }
        
        // Add patents data
        const patentData = this.competitorData.patents || [];
        reportContent += `\n\nPATENTS & IP\n-----------\n`;
        reportContent += `Total Patents: ${patentData.length}\n\n`;
        
        if (patentData.length > 0) {
            reportContent += `Recent Patents:\n`;
            patentData.slice(0, 5).forEach(patent => {
                reportContent += `- ${patent.title || 'Unknown'}\n`;
                reportContent += `  Number: ${patent.patentNumber || 'Unknown'}, Date: ${patent.date || 'Unknown'}\n`;
                reportContent += `  Assignee: ${patent.assignee || 'Unknown'}\n\n`;
            });
        } else {
            reportContent += `No patent data available.\n`;
        }
        
        // Add market data based on competitor type
        reportContent += `\n\nMARKET DATA\n-----------\n`;
        
        if (this.competitorData.type === 'device') {
            const cmsPartB = this.competitorData.cmsPartB || {};
            
            // Calculate totals
            let totalServices = 0;
            let totalPayment = 0;
            
            Object.values(cmsPartB).forEach(data => {
                if (Array.isArray(data)) {
                    data.forEach(item => {
                        totalServices += (item.implantations || 0);
                        totalPayment += (item.totalPayment || 0);
                    });
                }
            });
            
            reportContent += `Total Medicare Services: ${totalServices.toLocaleString()}\n`;
            reportContent += `Total Medicare Payments: $${totalPayment.toLocaleString()}\n`;
            reportContent += `CPT Codes: ${summary.marketMetrics?.cptCodes || 'Unknown'}\n`;
        } else if (this.competitorData.type === 'drug') {
            const cmsPartD = this.competitorData.cmsPartD || {};
            
            // Calculate totals
            let totalClaims = 0;
            let totalSpending = 0;
            
            Object.values(cmsPartD).forEach(yearData => {
                if (yearData && yearData.summary) {
                    totalClaims += yearData.summary.totalClaims || 0;
                    totalSpending += yearData.summary.totalSpending || 0;
                }
            });
            
            reportContent += `Total Medicare Claims: ${totalClaims.toLocaleString()}\n`;
            reportContent += `Total Medicare Spending: $${totalSpending.toLocaleString()}\n`;
            
            // Add Orange Book data if available
            const orangeBook = this.competitorData.orangeBook || {};
            
            if (orangeBook.summary) {
                reportContent += `\nOrange Book Data:\n`;
                reportContent += `- Products: ${orangeBook.products?.length || 0}\n`;
                reportContent += `- Patents: ${orangeBook.patents?.length || 0}\n`;
                reportContent += `- Exclusivity End: ${orangeBook.summary.exclusivityEnd || 'Unknown'}\n`;
                reportContent += `- Patent End: ${orangeBook.summary.patentEnd || 'Unknown'}\n`;
            }
        } else {
            reportContent += `Limited market data available for early-stage companies.\n`;
        }
        
        // Add SEC filings data if available
        const secFilings = this.competitorData.secFilings || [];
        
        if (secFilings.length > 0) {
            reportContent += `\n\nSEC FILINGS\n-----------\n`;
            reportContent += `Total SEC Filings: ${secFilings.length}\n\n`;
            
            reportContent += `Recent SEC Filings:\n`;
            secFilings.slice(0, 5).forEach(filing => {
                reportContent += `- ${filing.form || 'Unknown'}: ${filing.description || 'No description'}\n`;
                reportContent += `  Filed: ${filing.filingDate || 'Unknown'}, Report Date: ${filing.reportDate || 'Unknown'}\n\n`;
            });
        }
        
        // Create download link
        const blob = new Blob([reportContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.competitorData.name.replace(/\s+/g, '_')}_Competitor_Report.txt`;
        a.click();
        
        // Clean up
        URL.revokeObjectURL(url);
    },
    // Add fallback messages for no data scenarios
addNoDataFallbacks() {
    const noDataMessage = (title, message, icon = 'clipboard') => `
      <div class="bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-center">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 mb-4">
          <svg class="h-8 w-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            ${icon === 'clipboard' 
              ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />'
              : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />'}
          </svg>
        </div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">${title}</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400">${message}</p>
      </div>
    `;
    
    // Check for empty content in each tab and add fallback message
    if (document.getElementById('trials-table-body') && 
        document.getElementById('trials-table-body').children.length === 0) {
      const trialsContent = document.getElementById('trials-content');
      if (trialsContent) {
        trialsContent.innerHTML = noDataMessage(
          'No Clinical Trials Found',
          'There are no clinical trials associated with this competitor at this time. Check back later for updates.'
        );
      }
    }
    
    if (document.getElementById('patents-table-body') && 
        document.getElementById('patents-table-body').children.length === 0) {
      const patentsContent = document.getElementById('patent-ip');
      if (patentsContent) {
        patentsContent.innerHTML = noDataMessage(
          'No Patents Found',
          'There are no patents associated with this competitor at this time. This may be because the company is early-stage or doesn\'t have public patent filings.',
          'info'
        );
      }
    }
    
    // Also check market data
    if (document.getElementById('device-market-section') && 
        document.getElementById('device-market-section').classList.contains('hidden') &&
        document.getElementById('drug-market-section') && 
        document.getElementById('drug-market-section').classList.contains('hidden')) {
      const marketContent = document.getElementById('market-content');
      if (marketContent) {
        marketContent.innerHTML = noDataMessage(
          'No Market Data Available',
          'Market data for this competitor is not currently available. This may be because the product is pre-market or market data is still being collected.',
          'chart'
        );
      }
    }
  },
  
  // Override the native fetch function to add cache control and logging
  upgradeApiRequests() {
    // Store the original fetch function
    const originalFetch = window.fetch;
    
    // Override with our enhanced version
    window.fetch = async function(...args) {
      const url = args[0];
      const options = args[1] || {};
      
      // Add cache control for API requests
      if (typeof url === 'string' && url.includes('/api/')) {
        options.headers = {
          ...options.headers,
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        };
        
        console.log(`API Request: ${url}`);
      }
      
      try {
        const response = await originalFetch(url, options);
        
        // Create a clone we can read (response body can only be consumed once)
        const responseClone = response.clone();
        
        // Log unsuccessful responses
        if (!response.ok) {
          console.warn(`API Error: ${url}`, {
            status: response.status,
            statusText: response.statusText
          });
          
          try {
            const errorData = await responseClone.json();
            console.warn('API Error Details:', errorData);
          } catch (e) {
            // If we can't parse as JSON, just log the text
            console.warn('API Error Response:', await responseClone.text());
          }
        }
        
        return response;
      } catch (error) {
        console.error(`Network Error for ${url}:`, error);
        throw error;
      }
    };
  },
  
  // ENHANCEMENTS TO THE DATA API ADAPTERS
  
  // Function to standardize API responses and handle common edge cases
  standardizeApiResponse(responseData, entityType) {
    if (!responseData) return null;
    
    // Check if the response has the expected structure
    if (!responseData.data && !responseData.success) {
      // If it's just a raw array or object, wrap it
      return {
        success: true,
        data: Array.isArray(responseData) ? responseData : [responseData]
      };
    }
    
    // Already has the right structure
    return responseData;
  },
  
  // Enhanced API connection function with retries and detailed error logging
  async fetchWithRetry(url, options = {}, retries = 3, backoff = 300) {
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorBody = await response.text();
        
        console.error(`API Error (${response.status}): ${url}`, {
          status: response.status,
          statusText: response.statusText,
          body: errorBody.slice(0, 500) // Truncate long error responses
        });
        
        if (retries > 0 && (response.status === 429 || response.status >= 500)) {
          console.log(`Retrying ${url} in ${backoff}ms... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          return this.fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      if (retries > 0) {
        console.log(`Network error, retrying ${url} in ${backoff}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return this.fetchWithRetry(url, options, retries - 1, backoff * 2);
      }
      
      throw error;
    }
  }
};

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => app.init());
document.addEventListener('DOMContentLoaded', function() {
    // Add global window functions for debugging
    window.formatDate = (dateString) => {
      if (!dateString) return 'Unknown';
      
      try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        
        return date.toLocaleDateString(undefined, {
          year: 'numeric', 
          month: 'short', 
          day: 'numeric'
        });
      } catch (e) {
        return dateString;
      }
    };
    
    app.upgradeApiRequests();
  });

// Check for saved dark mode preference
if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.classList.add('dark');
}


  // // Render Market data tab ////////////////////////////////////////////////////////////////////////////////////////////
    // renderMarketData() {
    //     // Get market data based on competitor type
    //     if (this.competitorData.type === 'device') {
    //         this.renderDeviceMarketData();
    //     } else if (this.competitorData.type === 'drug') {
    //         this.renderDrugMarketData();
    //     } else {
    //         this.renderEarlyStageMarketData();
    //     }
    // },
    
    // // Render device market data
    // renderDeviceMarketData() {
    //     // Show device section and hide others
    //     document.getElementById('device-market-section').classList.remove('hidden');
    //     document.getElementById('drug-market-section').classList.add('hidden');
    //     document.getElementById('early-stage-market-section').classList.add('hidden');
        
    //     // Get CMS Part B data
    //     const cmsPartB = this.competitorData.cmsPartB || {};
    //     this.logData('CMS Part B Data for Rendering', cmsPartB);
        
    //     // Get summary data
    //     const summary = this.competitorData.summary || {};
        
    //     // Set CPT codes
    //     document.getElementById('cpt-codes').textContent = 
    //         summary.marketMetrics?.cptCodes || 'Unknown';
        
    //     // Set total implantations
    //     document.getElementById('total-implantations').textContent = 
    //         summary.marketMetrics?.totalImplantations ? 
    //         Number(summary.marketMetrics.totalImplantations).toLocaleString() : 
    //         'Unknown';
        
    //     // Calculate average reimbursement across all codes
    //     let totalPayment = 0;
    //     let totalServices = 0;
        
    //     Object.values(cmsPartB).forEach(data => {
    //         if (Array.isArray(data)) {
    //             data.forEach(item => {
    //                 totalPayment += (item.totalPayment || 0);
    //                 totalServices += (item.implantations || 0);
    //             });
    //         }
    //     });
        
    //     const avgReimbursement = totalServices > 0 ? 
    //         totalPayment / totalServices : 0;
        
    //         document.getElementById('avg-reimbursement').textContent = 
    //         `$${avgReimbursement.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        
    //     // Set YoY growth (placeholder for now)
    //     document.getElementById('yoy-growth').textContent = 'N/A';
        
    //     // Render implantation trend chart if we have multi-year data
    //     this.renderImplantationTrendChart(cmsPartB);
        
    //     // Populate CMS Part B table
    //     const cmsTableBody = document.getElementById('cms-part-b-table-body');
    //     cmsTableBody.innerHTML = '';
        
    //     // Flatten CMS data for the table
    //     const cmsRows = [];
        
    //     Object.entries(cmsPartB).forEach(([key, data]) => {
    //         if (Array.isArray(data) && data.length > 0) {
    //             data.forEach(item => {
    //                 // Extract CPT code from the key if not in the item
    //                 let cptCode = item.hcpcsCode;
    //                 if (!cptCode && key.includes('-')) {
    //                     cptCode = key.split('-')[0];
    //                 }
                    
    //                 cmsRows.push({
    //                     cptCode: cptCode || 'Unknown',
    //                     description: item.hcpcsDescription || 'Unknown',
    //                     year: item.year || 'Unknown',
    //                     services: item.implantations || 0,
    //                     avgPayment: item.avgPayment || 0,
    //                     totalPayment: item.totalPayment || 0
    //                 });
    //             });
    //         }
    //     });
        
    //     // Sort by year (newest first) and then by CPT code
    //     cmsRows.sort((a, b) => {
    //         if (b.year !== a.year) return b.year - a.year;
    //         return a.cptCode.localeCompare(b.cptCode);
    //     });
        
    //     if (cmsRows.length > 0) {
    //         cmsRows.forEach(row => {
    //             const tr = document.createElement('tr');
    //             tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
                
    //             tr.innerHTML = `
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     ${row.cptCode}
    //                 </td>
    //                 <td class="px-6 py-4 text-sm text-gray-900 dark:text-white">
    //                     ${row.description}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     ${row.year}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     ${row.services.toLocaleString()}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     $${row.avgPayment.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    //                 </td>
    //                 <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
    //                     $${row.totalPayment.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    //                 </td>
    //             `;
                
    //             cmsTableBody.appendChild(tr);
    //         });
    //     } else {
    //         const tr = document.createElement('tr');
    //         tr.innerHTML = `
    //             <td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
    //                 No Medicare claims data available
    //             </td>
    //         `;
    //         cmsTableBody.appendChild(tr);
    //     }
    // },
    
    // // Render drug market data
    // renderDrugMarketData() {
    //     // Show drug section and hide others
    //     document.getElementById('device-market-section').classList.add('hidden');
    //     document.getElementById('drug-market-section').classList.remove('hidden');
    //     document.getElementById('early-stage-market-section').classList.add('hidden');
        
    //     // Get CMS Part D data
    //     const cmsPartD = this.competitorData.cmsPartD || {};
    //     this.logData('CMS Part D Data for Rendering', cmsPartD);
        
    //     // Calculate totals across all years
    //     let totalClaims = 0;
    //     let totalSpending = 0;
    //     let topSpecialties = {};
        
    //     Object.values(cmsPartD).forEach(yearData => {
    //         if (yearData && yearData.summary) {
    //             totalClaims += yearData.summary.totalClaims || 0;
    //             totalSpending += yearData.summary.totalSpending || 0;
                
    //             // Collect specialty data for chart
    //             if (yearData.summary.topSpecialties) {
    //                 yearData.summary.topSpecialties.forEach(specialty => {
    //                     if (!topSpecialties[specialty.value]) {
    //                         topSpecialties[specialty.value] = 0;
    //                     }
    //                     topSpecialties[specialty.value] += specialty.count;
    //                 });
    //             }
    //         }
    //     });
        
    //     // Set metrics
    //     document.getElementById('total-claims').textContent = totalClaims.toLocaleString();
    //     document.getElementById('total-spending').textContent = `$${totalSpending.toLocaleString()}`;
    //     document.getElementById('avg-cost-per-claim').textContent = 
    //         `$${(totalClaims > 0 ? totalSpending / totalClaims : 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        
    //     // Check orange book data for product status
    //     const orangeBook = this.competitorData.orangeBook || {};
    //     document.getElementById('product-status').textContent = 
    //         orangeBook.products?.length > 0 ? 'Active' : 'Unknown';
        
    //     // Render spending trend chart
    //     this.renderSpendingTrendChart(cmsPartD);
        
    //     // Render specialty distribution chart
    //     this.renderSpecialtyDistributionChart(topSpecialties);
    // },
    
    // // Render early-stage market data
    // renderEarlyStageMarketData() {
    //     // Show early-stage section and hide others
    //     document.getElementById('device-market-section').classList.add('hidden');
    //     document.getElementById('drug-market-section').classList.add('hidden');
    //     document.getElementById('early-stage-market-section').classList.remove('hidden');
        
    //     // Set placeholder data
    //     document.getElementById('development-stage').textContent = 'Research & Development';
    //     document.getElementById('funding-info').textContent = 'Unknown';
    //     document.getElementById('threat-level').textContent = 'Medium';
    // },
    
    // // Render implantation trend chart for devices
    // renderImplantationTrendChart(cmsPartB) {
    //     // Destroy previous chart if it exists
    //     if (this.charts.implantationTrend) {
    //         this.charts.implantationTrend.destroy();
    //     }
        
    //     // Organize data by year and CPT code
    //     const yearlyData = {};
    //     const cptCodes = new Set();
        
    //     Object.entries(cmsPartB).forEach(([key, data]) => {
    //         if (Array.isArray(data) && data.length > 0) {
    //             data.forEach(item => {
    //                 const year = item.year || 'Unknown';
    //                 const cptCode = item.hcpcsCode || (key.includes('-') ? key.split('-')[0] : 'Unknown');
                    
    //                 if (!yearlyData[year]) yearlyData[year] = {};
    //                 if (!yearlyData[year][cptCode]) yearlyData[year][cptCode] = 0;
                    
    //                 yearlyData[year][cptCode] += (item.implantations || 0);
    //                 cptCodes.add(cptCode);
    //             });
    //         }
    //     });
        
    //     // Sort years and prepare chart data
    //     const years = Object.keys(yearlyData).sort();
        
    //     const datasets = Array.from(cptCodes).map((cptCode, index) => {
    //         // Generate a color based on index
    //         const hue = (index * 137) % 360; // Golden ratio to distribute colors
    //         const color = `hsl(${hue}, 70%, 60%)`;
            
    //         return {
    //             label: `CPT ${cptCode}`,
    //             data: years.map(year => yearlyData[year][cptCode] || 0),
    //             backgroundColor: color,
    //             borderColor: color,
    //             borderWidth: 2,
    //             fill: false
    //         };
    //     });
        
    //     // Create chart
    //     const ctx = document.getElementById('implantation-trend-chart').getContext('2d');
    //     this.charts.implantationTrend = new Chart(ctx, {
    //         type: 'line',
    //         data: {
    //             labels: years,
    //             datasets: datasets
    //         },
    //         options: {
    //             responsive: true,
    //             maintainAspectRatio: false,
    //             scales: {
    //                 y: {
    //                     beginAtZero: true,
    //                     title: {
    //                         display: true,
    //                         text: 'Implantations/Services'
    //                     }
    //                 },
    //                 x: {
    //                     title: {
    //                         display: true,
    //                         text: 'Year'
    //                     }
    //                 }
    //             },
    //             plugins: {
    //                 legend: {
    //                     position: 'top'
    //                 },
    //                 tooltip: {
    //                     callbacks: {
    //                         label: function(context) {
    //                             return `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`;
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //     });
    // },
    
    // // Render spending trend chart for drugs
    // renderSpendingTrendChart(cmsPartD) {
    //     // Destroy previous chart if it exists
    //     if (this.charts.spendingTrend) {
    //         this.charts.spendingTrend.destroy();
    //     }
        
    //     // Extract yearly data
    //     const years = Object.keys(cmsPartD).sort();
    //     const spending = years.map(year => {
    //         return cmsPartD[year]?.summary?.totalSpending || 0;
    //     });
    //     const claims = years.map(year => {
    //         return cmsPartD[year]?.summary?.totalClaims || 0;
    //     });
        
    //     // Create chart
    //     const ctx = document.getElementById('spending-trend-chart').getContext('2d');
    //     this.charts.spendingTrend = new Chart(ctx, {
    //         type: 'bar',
    //         data: {
    //             labels: years,
    //             datasets: [
    //                 {
    //                     label: 'Total Spending ($)',
    //                     data: spending,
    //                     backgroundColor: 'rgba(59, 130, 246, 0.6)',
    //                     borderColor: 'rgba(59, 130, 246, 1)',
    //                     borderWidth: 1,
    //                     yAxisID: 'y'
    //                 },
    //                 {
    //                     label: 'Total Claims',
    //                     data: claims,
    //                     backgroundColor: 'rgba(16, 185, 129, 0.6)',
    //                     borderColor: 'rgba(16, 185, 129, 1)',
    //                     borderWidth: 1,
    //                     type: 'line',
    //                     yAxisID: 'y1'
    //                 }
    //             ]
    //         },
    //         options: {
    //             responsive: true,
    //             maintainAspectRatio: false,
    //             scales: {
    //                 y: {
    //                     type: 'linear',
    //                     display: true,
    //                     position: 'left',
    //                     title: {
    //                         display: true,
    //                         text: 'Total Spending ($)'
    //                     }
    //                 },
    //                 y1: {
    //                     type: 'linear',
    //                     display: true,
    //                     position: 'right',
    //                     title: {
    //                         display: true,
    //                         text: 'Total Claims'
    //                     },
    //                     grid: {
    //                         drawOnChartArea: false
    //                     }
    //                 }
    //             },
    //             plugins: {
    //                 legend: {
    //                     position: 'top'
    //                 },
    //                 tooltip: {
    //                     callbacks: {
    //                         label: function(context) {
    //                             if (context.dataset.label.includes('Spending')) {
    //                                 return `${context.dataset.label}: $${context.parsed.y.toLocaleString()}`;
    //                             }
    //                             return `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`;
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //     });
    // },
    
    // // Render specialty distribution chart for drugs
    // renderSpecialtyDistributionChart(specialties) {
    //     // Destroy previous chart if it exists
    //     if (this.charts.specialtyDistribution) {
    //         this.charts.specialtyDistribution.destroy();
    //     }
        
    //     // Prepare data for chart
    //     const specialtyEntries = Object.entries(specialties);
        
    //     // Sort by count (descending) and limit to top 8
    //     specialtyEntries.sort((a, b) => b[1] - a[1]);
    //     const topSpecialties = specialtyEntries.slice(0, 8);
        
    //     // Add "Other" category if there are more specialties
    //     if (specialtyEntries.length > 8) {
    //         const otherSum = specialtyEntries.slice(8).reduce((sum, [_, count]) => sum + count, 0);
    //         topSpecialties.push(['Other', otherSum]);
    //     }
        
    //     // Generate chart colors
    //     const colors = topSpecialties.map((_, index) => {
    //         const hue = (index * 137) % 360; // Golden ratio to distribute colors
    //         return `hsl(${hue}, 70%, 60%)`;
    //     });
        
    //     // Create chart
    //     const ctx = document.getElementById('specialty-distribution-chart').getContext('2d');
    //     this.charts.specialtyDistribution = new Chart(ctx, {
    //         type: 'pie',
    //         data: {
    //             labels: topSpecialties.map(([specialty]) => specialty),
    //             datasets: [{
    //                 data: topSpecialties.map(([_, count]) => count),
    //                 backgroundColor: colors,
    //                 borderColor: colors.map(color => color.replace('60%', '50%')),
    //                 borderWidth: 1
    //             }]
    //         },
    //         options: {
    //             responsive: true,
    //             maintainAspectRatio: false,
    //             plugins: {
    //                 legend: {
    //                     position: 'right'
    //                 },
    //                 tooltip: {
    //                     callbacks: {
    //                         label: function(context) {
    //                             const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
    //                             const percent = Math.round((context.parsed / total) * 100);
    //                             return `${context.label}: ${context.parsed.toLocaleString()} (${percent}%)`;
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //     });
    // },
    
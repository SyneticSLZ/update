// Base API URL (should match your backend server)
const API_BASE_URL = 'https://update-g6ic.onrender.com0';

// App state
const app = {
    competitors: [],
    mainCompetitors: [],
    earlyStageCompetitors: [],
    isLoading: true,
    error: null,
    filters: {
        search: '',
        type: 'all',
        treatment: 'all',
        sort: 'name'
    },
    charts: {},

    async init() {
        // Set up event listeners
        this.setupEventListeners();
        
        // Initialize dark mode based on user preference
        this.initializeDarkMode();
        
        // Load competitor data
        await this.fetchCompetitors();
        
        // Initialize the market overview section
        await this.initializeCharts();
    },

    setupEventListeners() {
        // Dark mode toggle
        document.getElementById('dark-mode-toggle').addEventListener('click', this.toggleDarkMode);
        
        // Search functionality
        document.getElementById('search-input').addEventListener('input', (e) => {
            this.filters.search = e.target.value.toLowerCase();
            this.applyFilters();
        });
        document.getElementById('search-button').addEventListener('click', () => this.applyFilters());
        
        // Filter controls
        document.getElementById('filter-type').addEventListener('change', (e) => {
            this.filters.type = e.target.value;
            this.applyFilters();
        });
        document.getElementById('filter-treatment').addEventListener('change', (e) => {
            this.filters.treatment = e.target.value;
            this.applyFilters();
        });
        document.getElementById('filter-sort').addEventListener('change', (e) => {
            this.filters.sort = e.target.value;
            this.applyFilters();
        });
        
        // Filter button actions
        document.getElementById('apply-filters').addEventListener('click', () => this.applyFilters());
        document.getElementById('reset-filters').addEventListener('click', () => this.resetFilters());
        
        // Retry button for error state
        const retryButton = document.getElementById('retry-button');
        if(retryButton) {
            retryButton.addEventListener('click', () => this.fetchCompetitors());
        }
    },

    initializeDarkMode() {
        // Check if user has a preference stored
        const darkMode = localStorage.getItem('darkMode');
        if (darkMode === 'true') {
            document.documentElement.classList.add('dark');
        }
    },

    toggleDarkMode() {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('darkMode', document.documentElement.classList.contains('dark'));
    },

    showLoading() {
        this.isLoading = true;
        document.getElementById('loading-indicator').classList.remove('hidden');
        document.getElementById('error-message').classList.add('hidden');
        document.getElementById('main-competitors-container').classList.add('opacity-50');
        document.getElementById('early-stage-container').classList.add('opacity-50');
    },

    hideLoading() {
        this.isLoading = false;
        document.getElementById('loading-indicator').classList.add('hidden');
        document.getElementById('main-competitors-container').classList.remove('opacity-50');
        document.getElementById('early-stage-container').classList.remove('opacity-50');
    },

    showError(message) {
        this.error = message;
        document.getElementById('loading-indicator').classList.add('hidden');
        document.getElementById('error-message').classList.remove('hidden');
        document.getElementById('error-message').querySelector('p').textContent = message;
    },

    async fetchCompetitors() {
        try {
            this.showLoading();
            
            // Fetch competitors from backend
            const response = await fetch(`${API_BASE_URL}/api/competitors`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const competitorsData = await response.json();
            
            // If no competitors found, show a message
            if (!competitorsData || competitorsData.length === 0) {
                throw new Error("No competitor data found");
            }

            // Fetch market share data in parallel
            let marketShareData = {};
            try {
                const marketShareResponse = await fetch(`${API_BASE_URL}/api/analytics/marketshare`);
                if (marketShareResponse.ok) {
                    marketShareData = await marketShareResponse.json();
                }
            } catch (marketShareError) {
                console.warn('Market share data could not be loaded:', marketShareError);
                // Continue without market share data
            }

            // Process competitor data with market share
            this.competitors = competitorsData.map(competitor => {
                const marketInfo = marketShareData.shares?.[competitor.name] || {};
                return {
                    name: competitor.name,
                    type: competitor.type,
                    treatment: competitor.treatment,
                    marketShare: parseFloat(marketInfo.competitorPercentage) || 0,
                    growth: this.calculateGrowth(competitor),
                    hasSecData: competitor.hasSecData
                };
            });

            // Apply filters and update UI
            this.applyFilters();
            this.updateLastUpdated();
            this.hideLoading();
            
        } catch (error) {
            console.error('Error fetching competitors:', error);
            this.hideLoading();
            this.showError(`Failed to load competitor data: ${error.message}`);
        }
    },

    calculateGrowth(competitor) {
        // Growth rates based on competitor type
        // In a real application, this would come from analytics data
        const baseGrowth = {
            'device': 8.1,
            'drug': 6.3,
            'early-stage': 15.5
        };
        
        // Add some variance to make it look realistic
        const variance = (Math.random() * 2 - 1) * 2; // +/- 2%
        return parseFloat((baseGrowth[competitor.type] + variance || 5).toFixed(1));
    },

    updateLastUpdated() {
        const now = new Date();
        const formattedDate = now.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        document.getElementById('last-updated').textContent = `Last updated: ${formattedDate}`;
    },

    applyFilters() {
        let filtered = [...this.competitors];

        // Apply type filter
        if (this.filters.type !== 'all') {
            filtered = filtered.filter(c => c.type === this.filters.type);
        }

        // Apply treatment filter
        if (this.filters.treatment !== 'all') {
            filtered = filtered.filter(c => c.treatment.toLowerCase().includes(this.filters.treatment.toLowerCase()));
        }

        // Apply search filter
        if (this.filters.search) {
            filtered = filtered.filter(c => 
                c.name.toLowerCase().includes(this.filters.search) ||
                c.treatment.toLowerCase().includes(this.filters.search)
            );
        }

        // Apply sorting
        filtered.sort((a, b) => {
            switch (this.filters.sort) {
                case 'marketShare': return b.marketShare - a.marketShare;
                case 'growth': return b.growth - a.growth;
                default: return a.name.localeCompare(b.name);
            }
        });

        // Split competitors by type
        this.mainCompetitors = filtered.filter(c => c.type !== 'early-stage');
        this.earlyStageCompetitors = filtered.filter(c => c.type === 'early-stage');
        
        // Render the tables
        this.renderTables();
        
        // Update the charts if they exist
        this.updateCharts();
    },

    resetFilters() {
        this.filters = { search: '', type: 'all', treatment: 'all', sort: 'name' };
        
        // Reset form values
        document.getElementById('search-input').value = '';
        document.getElementById('filter-type').value = 'all';
        document.getElementById('filter-treatment').value = 'all';
        document.getElementById('filter-sort').value = 'name';
        
        // Apply the reset filters
        this.applyFilters();
    },

    renderTables() {
        this.renderTable('main-competitors-body', this.mainCompetitors, this.createMainCompetitorRow);
        this.renderTable('early-stage-body', this.earlyStageCompetitors, this.createEarlyStageRow);
    },

    renderTable(bodyId, data, rowCreator) {
        const tbody = document.getElementById(bodyId);
        
        // Clear the table body
        tbody.innerHTML = '';
        
        // Check if we have data to display
        if (data.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `<td colspan="6" class="px-6 py-4 text-center text-gray-500 dark:text-gray-400">No competitors found</td>`;
            tbody.appendChild(emptyRow);
            return;
        }

        // Create a row for each competitor
        data.forEach(item => {
            tbody.appendChild(rowCreator.call(this, item));
        });
    },

    createMainCompetitorRow(competitor) {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
        
        // Format the market share with 1 decimal place
        const marketShareDisplay = competitor.marketShare ? `${competitor.marketShare.toFixed(1)}%` : 'N/A';
        
        // Determine the growth status class
        const growthStatusClass = competitor.growth >= 7 ? 
            'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100' : 
            competitor.growth >= 4 ?
            'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100' :
            'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="font-medium text-gray-900 dark:text-white">${competitor.name}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                    ${competitor.type === 'device' ? 'Device' : 'Drug'}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">${competitor.treatment}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                    <div class="mr-2">Market Share:</div>
                    <div class="font-medium">${marketShareDisplay}</div>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 rounded-full text-xs ${growthStatusClass}">
                    ${competitor.growth}% Growth
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right">
                <a href="competitor-detail.html?name=${encodeURIComponent(competitor.name)}" 
                   class="px-3 py-1 text-white bg-marcomm-orange hover:bg-marcomm-orange-dark rounded transition-colors">
                    View Details
                </a>
            </td>
        `;
        
        return row;
    },

    createEarlyStageRow(competitor) {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
        
        // Determine threat level based on growth rate
        let threatLevel = 'Medium';
        let threatClass = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100';
        
        if (competitor.growth >= 15) {
            threatLevel = 'High';
            threatClass = 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
        } else if (competitor.growth < 10) {
            threatLevel = 'Low';
            threatClass = 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
        }
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="font-medium text-gray-900 dark:text-white">${competitor.name}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-100">
                    Early-Stage
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">${competitor.treatment}</td>
            <td class="px-6 py-4 whitespace-nowrap">Pre-clinical</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 rounded-full text-xs ${threatClass}">
                    ${threatLevel}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right">
                <a href="competitor-detail.html?name=${encodeURIComponent(competitor.name)}" 
                   class="px-3 py-1 text-white bg-marcomm-orange hover:bg-marcomm-orange-dark rounded transition-colors">
                    View Details
                </a>
            </td>
        `;
        
        return row;
    },

    async initializeCharts() {
        try {
            // First check if charts container exists
            const marketShareCtx = document.getElementById('market-share-chart');
            const growthCtx = document.getElementById('growth-chart');
            
            if (!marketShareCtx || !growthCtx) {
                console.warn('Chart canvas elements not found');
                return;
            }
            
            // Show loading state for charts
            const chartContainers = document.querySelectorAll('#market-overview .rounded-lg');
            chartContainers.forEach(container => {
                container.classList.add('animate-pulse');
            });
            
            // Fetch market share data
            try {
                const marketShareResponse = await fetch(`${API_BASE_URL}/api/analytics/marketshare`);
                if (!marketShareResponse.ok) {
                    throw new Error(`HTTP error! status: ${marketShareResponse.status}`);
                }
                
                const marketShareData = await marketShareResponse.json();
                
                // Prepare market share chart data
                const marketShares = Object.entries(marketShareData.shares || {})
                    .filter(([_, data]) => parseFloat(data.competitorPercentage) > 0)
                    .map(([name, data]) => ({
                        name,
                        share: parseFloat(data.competitorPercentage)
                    }));
                
                // Create chart
                this.charts.marketShare = new Chart(marketShareCtx, {
                    type: 'pie',
                    data: {
                        labels: marketShares.map(s => s.name),
                        datasets: [{
                            data: marketShares.map(s => s.share),
                            backgroundColor: [
                                '#FF6B35', '#3B82F6', '#10B981', '#F59E0B', 
                                '#8B5CF6', '#EC4899', '#14B8A6', '#F43F5E'
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
                                    color: document.documentElement.classList.contains('dark') ? '#F3F4F6' : '#1F2937'
                                }
                            },
                            title: { 
                                display: true, 
                                text: 'Market Share Distribution',
                                color: document.documentElement.classList.contains('dark') ? '#F3F4F6' : '#1F2937'
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const label = context.label || '';
                                        const value = context.raw || 0;
                                        return `${label}: ${value.toFixed(1)}%`;
                                    }
                                }
                            }
                        }
                    }
                });
                
                // Create growth chart based on competitor data
                this.charts.growth = new Chart(growthCtx, {
                    type: 'bar',
                    data: {
                        labels: this.mainCompetitors.map(c => c.name),
                        datasets: [{
                            label: 'Growth Rate (%)',
                            data: this.mainCompetitors.map(c => c.growth),
                            backgroundColor: '#FF6B35'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { 
                                beginAtZero: true,
                                ticks: {
                                    color: document.documentElement.classList.contains('dark') ? '#F3F4F6' : '#1F2937'
                                },
                                grid: {
                                    color: document.documentElement.classList.contains('dark') ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
                                }
                            },
                            x: {
                                ticks: {
                                    color: document.documentElement.classList.contains('dark') ? '#F3F4F6' : '#1F2937'
                                },
                                grid: {
                                    color: document.documentElement.classList.contains('dark') ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
                                }
                            }
                        },
                        plugins: {
                            legend: {
                                labels: {
                                    color: document.documentElement.classList.contains('dark') ? '#F3F4F6' : '#1F2937'
                                }
                            },
                            title: { 
                                display: true, 
                                text: 'Competitor Growth Rates',
                                color: document.documentElement.classList.contains('dark') ? '#F3F4F6' : '#1F2937'
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const label = context.dataset.label || '';
                                        const value = context.raw || 0;
                                        return `${label}: ${value.toFixed(1)}%`;
                                    }
                                }
                            }
                        }
                    }
                });
                
            } catch (error) {
                console.error('Error fetching market share data:', error);
                
                // Show error state in chart containers
                chartContainers.forEach(container => {
                    container.classList.remove('animate-pulse');
                    container.innerHTML = `
                        <div class="flex flex-col items-center justify-center h-full">
                            <div class="text-red-500 mb-2"><i class="fas fa-exclamation-circle text-xl"></i></div>
                            <p class="text-red-500 text-sm">Error loading chart data</p>
                        </div>
                    `;
                });
                
                return;
            }
            
            // Remove loading state
            chartContainers.forEach(container => {
                container.classList.remove('animate-pulse');
            });
            
        } catch (error) {
            console.error('Error initializing charts:', error);
        }
    },
    
    updateCharts() {
        // Update the growth chart if it exists
        if (this.charts.growth) {
            this.charts.growth.data.labels = this.mainCompetitors.map(c => c.name);
            this.charts.growth.data.datasets[0].data = this.mainCompetitors.map(c => c.growth);
            this.charts.growth.update();
        }
    }
};

// Handle dark mode preference change
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
    const newColorScheme = event.matches ? 'dark' : 'light';
    if (newColorScheme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', event.matches);
});

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => app.init());
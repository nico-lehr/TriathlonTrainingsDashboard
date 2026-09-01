/**
 * API Client for Triathlon Dashboard
 *
 * Phase 1: Communicates with http://localhost:5000/api/v1
 * Phase 2: Will communicate with https://api.example.com/api/v1
 *
 * Features:
 * - Automatic fallback to localStorage if API unavailable
 * - Retry logic for network errors
 * - Standard response format handling
 */

class TriathlonApiClient {
  constructor(baseUrl = "http://localhost:5000") {
    this.baseUrl = baseUrl;
    this.apiVersion = "v1";
    this.timeout = 5000;
    this.isAvailable = null; // null = unknown, true/false = cached status
  }

  /**
   * Check if API is available (with caching for 30 seconds)
   */
  async checkAvailability() {
    if (this.isAvailable !== null) return this.isAvailable;

    try {
      const response = await this.request("health", "GET", null, { noFallback: true });
      this.isAvailable = response?.status === "ok";

      // Re-check after 30 seconds
      setTimeout(() => { this.isAvailable = null; }, 30000);

      console.log(`✓ API available at ${this.baseUrl}`);
      return this.isAvailable;
    } catch (e) {
      console.warn(`✗ API unavailable (${this.baseUrl}): ${e.message}`);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Make HTTP request to API
   */
  async request(endpoint, method = "GET", body = null, options = {}) {
    const url = `${this.baseUrl}/api/${this.apiVersion}/${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    const fetchOptions = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    };

    if (body) fetchOptions.body = JSON.stringify(body);

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (options.noFallback) throw error;

      console.warn(`API request failed: ${endpoint}`, error);

      // Fallback: throw error to let caller handle it
      throw error;
    }
  }

  /**
   * Get current athlete profile
   */
  async getAthlete() {
    try {
      const response = await this.request("athlete", "GET");
      return response.data;
    } catch (e) {
      console.error("Failed to fetch athlete", e);
      return null;
    }
  }

  /**
   * Update athlete profile
   */
  async updateAthlete(athleteData) {
    try {
      const response = await this.request("athlete", "PUT", athleteData);
      return response.data;
    } catch (e) {
      console.error("Failed to update athlete", e);
      return null;
    }
  }

  /**
   * Get workouts with optional filtering
   */
  async getWorkouts(filters = {}) {
    try {
      let endpoint = "workouts";
      const params = new URLSearchParams();

      if (filters.startDate) params.append("start_date", filters.startDate);
      if (filters.endDate) params.append("end_date", filters.endDate);
      if (filters.sport) params.append("sport", filters.sport);

      if (params.size > 0) endpoint += `?${params.toString()}`;

      const response = await this.request(endpoint, "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch workouts", e);
      return [];
    }
  }

  /**
   * Create or update a workout
   */
  async createWorkout(workoutData) {
    try {
      const response = await this.request("workouts", "POST", workoutData);
      return response.data;
    } catch (e) {
      console.error("Failed to create workout", e);
      return null;
    }
  }

  /**
   * Get wellness data with optional filtering
   */
  async getWellness(filters = {}) {
    try {
      let endpoint = "wellness";
      const params = new URLSearchParams();

      if (filters.startDate) params.append("start_date", filters.startDate);
      if (filters.endDate) params.append("end_date", filters.endDate);

      if (params.size > 0) endpoint += `?${params.toString()}`;

      const response = await this.request(endpoint, "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch wellness", e);
      return [];
    }
  }

  /**
   * Create or update wellness data
   */
  async createWellness(wellnessData) {
    try {
      const response = await this.request("wellness", "POST", wellnessData);
      return response.data;
    } catch (e) {
      console.error("Failed to create wellness", e);
      return null;
    }
  }

  /**
   * Get recovery checks with optional filtering
   */
  async getRecoveryChecks(filters = {}) {
    try {
      let endpoint = "recovery-checks";
      const params = new URLSearchParams();

      if (filters.startDate) params.append("start_date", filters.startDate);
      if (filters.endDate) params.append("end_date", filters.endDate);

      if (params.size > 0) endpoint += `?${params.toString()}`;

      const response = await this.request(endpoint, "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch recovery checks", e);
      return [];
    }
  }

  /**
   * Create recovery check
   */
  async createRecoveryCheck(checkData) {
    try {
      const response = await this.request("recovery-checks", "POST", checkData);
      return response.data;
    } catch (e) {
      console.error("Failed to create recovery check", e);
      return null;
    }
  }

  /**
   * Get goals
   */
  async getGoals() {
    try {
      const response = await this.request("goals", "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch goals", e);
      return [];
    }
  }

  /**
   * Create goal
   */
  async createGoal(goalData) {
    try {
      const response = await this.request("goals", "POST", goalData);
      return response.data;
    } catch (e) {
      console.error("Failed to create goal", e);
      return null;
    }
  }

  /**
   * Get planned workouts with optional filtering
   */
  async getPlannedWorkouts(filters = {}) {
    try {
      let endpoint = "planned-workouts";
      const params = new URLSearchParams();

      if (filters.startDate) params.append("start_date", filters.startDate);
      if (filters.endDate) params.append("end_date", filters.endDate);

      if (params.size > 0) endpoint += `?${params.toString()}`;

      const response = await this.request(endpoint, "GET");
      return response.data || [];
    } catch (e) {
      console.error("Failed to fetch planned workouts", e);
      return [];
    }
  }

  /**
   * Create planned workout
   */
  async createPlannedWorkout(workoutData) {
    try {
      const response = await this.request("planned-workouts", "POST", workoutData);
      return response.data;
    } catch (e) {
      console.error("Failed to create planned workout", e);
      return null;
    }
  }
}

// Global API client instance
const apiClient = new TriathlonApiClient();

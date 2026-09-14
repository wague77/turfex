
import axios from "axios";

export const FORTUNE_API = "/api/fortune";

export const ddmmyyyy = (d) => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
};

const api = axios.create({ baseURL: FORTUNE_API, timeout: 25000 });

export const fetchFortuneProgramme = (date) => api.get(`/programme/${date}`).then((r) => r.data);
export const fetchFortuneParticipants = (date, r, c) =>
  api.get(`/programme/${date}/R${r}/C${c}/participants`).then((res) => res.data);
export const fortuneAnalyze = (horses) => api.post(`/analyze`, { horses }).then((r) => r.data);
export const fortuneGenTierce = (payload) => api.post(`/tickets/tierce`, payload).then((r) => r.data);
export const fortuneGenCouple = (payload) => api.post(`/tickets/couple`, payload).then((r) => r.data);
export const fortuneGetBankroll = () => api.get(`/bankroll`).then((r) => r.data);
export const fortuneAddBankroll = (e) => api.post(`/bankroll`, e).then((r) => r.data);
export const fortuneDelBankroll = (id) => api.delete(`/bankroll/${id}`).then((r) => r.data);


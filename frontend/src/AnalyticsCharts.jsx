import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const COLORS = ['#647b62', '#9c6a39', '#b45c53', '#6b759e', '#859a9c', '#b09067', '#697b70'];

export default function AnalyticsCharts({ mode, data, lines, empty = false, emptyMessage = 'No data is available for this period.', nameKey, valueKey }) {
  if (mode === 'distribution') {
    const values = (data || []).filter((entry) => Number(entry[valueKey]) > 0);
    if (!values.length) return <div className="empty-state chart-empty">No records to display yet.</div>;
    return <div className="analytics-plot">
      <ResponsiveContainer width="100%" height={270}>
        <PieChart>
          <Pie data={values} dataKey={valueKey} nameKey={nameKey} outerRadius={88} innerRadius={48} paddingAngle={2}>
            {values.map((entry, index) => <Cell key={entry[nameKey]} fill={COLORS[index % COLORS.length]} />)}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>;
  }

  const hasValues = (data || []).some((entry) => lines.some((line) => Number(entry[line.key]) > 0));
  if (empty || !hasValues) return <div className="empty-state chart-empty">{emptyMessage}</div>;
  return <div className="analytics-plot">
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 4 }}>
        <CartesianGrid stroke="#e6e9e5" strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(date) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} minTickGap={22} />
        <YAxis allowDecimals={false} />
        <Tooltip labelFormatter={(date) => new Date(`${date}T12:00:00`).toLocaleDateString()} />
        {lines.length > 1 && <Legend />}
        {lines.map((line) => <Line key={line.key} type="monotone" dataKey={line.key} name={line.name} stroke={line.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />)}
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

import PerformancesTable from '../../features/performances/PerformancesTable';

const Availability = () => (
  <PerformancesTable
    orientation='classes-as-columns'
    remainingMode='total'
    showFilters={false}
    availabilitySource='monitor'
  />
);

export default Availability;

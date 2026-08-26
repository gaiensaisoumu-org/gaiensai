import PerformancesTable from '../../features/performances/PerformancesTable';
import { AdminAuthLayout } from '../../layout/AdminAuthLayout';

const Availability = () => (
  <AdminAuthLayout title='公演空き状況' minimal>
    <PerformancesTable
      orientation='classes-as-columns'
      remainingMode='total'
      showFilters={false}
      availabilitySource='monitor'
    />
  </AdminAuthLayout>
);

export default Availability;

import { Link as RouterLink, type LinkProps } from "react-router-dom";
import { withChangeTask } from "./change-context";
export function Link(props: LinkProps) {
  return (
    <RouterLink
      {...props}
      to={
        typeof props.to === "string"
          ? withChangeTask(props.to)
          : {
              ...props.to,
              search: withChangeTask("x" + (props.to.search || "")).slice(1),
            }
      }
    />
  );
}
